import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { AiSetupPrompt } from "@/components/mealplan/AiSetupPrompt";
import { MealPlanEmptyState } from "@/components/mealplan/MealPlanEmptyState";
import {
  GeneratePlanControls,
  DEFAULT_DAY_COUNT,
} from "@/components/mealplan/GeneratePlanControls";
import { GenerationProgress } from "@/components/mealplan/GenerationProgress";
import { DayRail } from "@/components/mealplan/DayRail";
import { DaySection } from "@/components/mealplan/DaySection";
import { RecipeSheet } from "@/components/mealplan/RecipeSheet";
import { PlanShoppingSheet } from "@/components/mealplan/PlanShoppingSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useHouseStore } from "@/lib/houseStore";
import { queryKeys } from "@/lib/queryKeys";
import { api, type IngredientSource, type MealPlanMealDetail } from "@/lib/api";
import { parseLocalDate, addDays, toIsoDateString } from "@/lib/dates";
import {
  useMealPlanControlsStore,
  usedSlots,
  SLOT_LABELS,
  formatMealPlanDayHeading,
} from "@/lib/mealPlanControls";
import {
  aggregateMealPlanIngredients,
  summarizeIngredientAggregates,
  toBuyCountsByDay,
} from "@/lib/mealPlanIngredients";
import { useMealPlanGeneration, classifyMealPlanError } from "@/hooks/useMealPlanGeneration";
import { useMealPlanMutations } from "@/hooks/useMealPlanMutations";

function isExpiringSoon(item: { expirationDate?: string | null }): boolean {
  if (!item.expirationDate) return false;
  const d = parseLocalDate(item.expirationDate);
  if (!d) return false;
  return d > new Date() && d <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function isExpired(item: { expirationDate?: string | null }): boolean {
  if (!item.expirationDate) return false;
  const d = parseLocalDate(item.expirationDate);
  return d ? d < new Date() : false;
}

const NAV_KEYS = new Set(["Home", "End", "PageUp", "PageDown"]);

export default function MealPlanPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { recipeId } = useParams<{ recipeId?: string }>();
  const { clearAuth, user } = useAuth();
  const { selectedHouseId } = useHouseStore();
  const controls = useMealPlanControlsStore();
  const [showNewPlanControls, setShowNewPlanControls] = useState(false);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [shoppingSheetOpen, setShoppingSheetOpen] = useState(false);
  const [shoppingStatusMessage, setShoppingStatusMessage] = useState<string | null>(null);

  const sectionRefs = useRef(new Map<number, HTMLElement>());
  const dayStackRef = useRef<HTMLDivElement | null>(null);
  const headingRefs = useRef(new Map<number, HTMLHeadingElement>());
  const hasAnchoredRef = useRef(false);
  // How many DISTINCT ingredient names were requested in the in-flight commit — set
  // right before firing the mutation, read back in `onCommitSuccess` below (the
  // mutation callback only gets the server's `{ created, skipped }`, not the request).
  const lastCommitRequestedCountRef = useRef(0);

  const { data: household } = useQuery({
    queryKey: queryKeys.household.details(),
    queryFn: () => api.getHousehold(),
    retry: false,
  });

  const { data: llmSettings, isLoading: isLoadingLlmSettings } = useQuery({
    queryKey: queryKeys.aiSettings.details(),
    queryFn: () => api.getLlmSettings(),
  });

  const { data: items = [] } = useQuery({
    queryKey: queryKeys.inventory.list(selectedHouseId),
    queryFn: () => api.getItems(selectedHouseId ?? undefined),
  });

  const totalItems = items.length;
  const expiringCount = useMemo(() => items.filter(isExpiringSoon).length, [items]);
  const expiredCount = useMemo(() => items.filter(isExpired).length, [items]);

  // Discovers the household's most recent plan regardless of status. Deliberately
  // uses the SAME query key as `useMealPlanGeneration`'s internal lookup (plan §5.8)
  // so the two never issue duplicate requests — react-query dedupes by key.
  const currentPlanQuery = useQuery({
    queryKey: queryKeys.mealPlan.current(null),
    queryFn: () => api.getCurrentMealPlan(),
  });
  const latestPlanId = currentPlanQuery.data?.id ?? null;

  const generation = useMealPlanGeneration();

  // `useMealPlanGeneration` only auto-attaches when the most recent plan is still
  // generating (by design — see its own doc comment). When it's already terminal
  // on a fresh mount, this page fetches the full detail itself.
  const terminalDetailQuery = useQuery({
    queryKey: latestPlanId ? queryKeys.mealPlan.detail(latestPlanId) : queryKeys.mealPlan.details(),
    queryFn: () => api.getMealPlan(latestPlanId as string),
    enabled: latestPlanId !== null && generation.planId === null,
    staleTime: Infinity,
  });

  const plan = generation.plan ?? terminalDetailQuery.data ?? null;
  const isGenerating = generation.isGenerating;
  const displayError = generation.planId ? generation.error : classifyMealPlanError(plan);

  const mutations = useMealPlanMutations({
    onIngredientToggleError: () => {},
    onCommitSuccess: (created, skipped) => {
      // A commit that silently "Added 0 items" (or fewer than requested) with no
      // explanation used to look identical to success — warn whenever the server
      // reports items it skipped, or (defensively, in case `skipped` lands as 0/absent
      // for some other reason) whenever fewer were created than were requested.
      const requested = lastCommitRequestedCountRef.current;
      const shortfall = skipped > 0 ? skipped : Math.max(0, requested - created);
      if (shortfall > 0) {
        setShoppingStatusMessage(
          created === 0
            ? `Added 0 items — ${shortfall} ${shortfall === 1 ? "was" : "were"} already on your re-order list.`
            : `Added ${created} item${created === 1 ? "" : "s"}; ${shortfall} ${shortfall === 1 ? "was" : "were"} already on your re-order list.`
        );
      } else {
        setShoppingStatusMessage(
          created === 1
            ? "Added 1 item to your re-order list."
            : `Added ${created} items to your re-order list.`
        );
      }
    },
    onCommitError: (msg) => setShoppingStatusMessage(msg),
    onDeleteSuccess: () => {},
    onDeleteError: () => {},
    onRegenerateMealError: () => {},
  });

  // The needs-purchase surface (plan §5.4). Computed at render, NEVER cached — see
  // the CRITICAL cache rule in `lib/queryKeys.ts` and `lib/mealPlanIngredients.ts`'s
  // doc comment. This is the one place that classification is derived, so every
  // existing inventory invalidation refreshes it for free.
  const buyListAggregates = useMemo(
    () => (plan ? aggregateMealPlanIngredients(plan, items) : []),
    [plan, items]
  );
  const buyListSummary = useMemo(
    () => summarizeIngredientAggregates(buyListAggregates),
    [buyListAggregates]
  );
  const toBuyByDay = useMemo(() => toBuyCountsByDay(buyListAggregates), [buyListAggregates]);

  const handleCommitShopping = useCallback(
    (ingredientIds: string[], requestedCount: number) => {
      if (!plan || ingredientIds.length === 0) return;
      lastCommitRequestedCountRef.current = requestedCount;
      mutations.commitShopping(plan.id, ingredientIds);
    },
    [plan, mutations]
  );

  // The one UI path to correct a stale have/buy classification (plan §5.4) short of
  // deleting and regenerating the whole plan. An aggregate row can span several
  // underlying `MealPlanIngredient` rows (same ingredient used across multiple
  // meals/days); flipping the row flips every one of them.
  const handleToggleIngredientSource = useCallback(
    (ingredientIds: string[], nextSource: IngredientSource) => {
      if (!plan) return;
      for (const ingredientId of ingredientIds) {
        mutations.toggleIngredientSource(plan.id, ingredientId, nextSource);
      }
    },
    [plan, mutations]
  );

  const handleRetryMeal = useCallback(
    (mealId: string) => {
      if (!plan) return;
      mutations.regenerateMeal(plan.id, mealId);
    },
    [plan, mutations]
  );
  const isRetryingMeal = (mealId: string) =>
    mutations.regenerateMealMutation.isPending &&
    mutations.regenerateMealMutation.variables?.mealId === mealId;

  const planExists = plan !== null || generation.planId !== null || latestPlanId !== null;
  const hasKey = llmSettings?.keyConfigured ?? false;
  const isDiscovering =
    isLoadingLlmSettings ||
    currentPlanQuery.isLoading ||
    generation.isAttaching ||
    terminalDetailQuery.isLoading;

  useEffect(() => {
    if (isGenerating) setShowNewPlanControls(false);
  }, [isGenerating]);

  const todayIso = toIsoDateString(new Date());
  const dayCount = plan?.dayCount ?? DEFAULT_DAY_COUNT;
  const startDate = plan?.startDate ?? todayIso;

  const dayViewModels = useMemo(() => {
    const startParsed = parseLocalDate(startDate) ?? new Date();
    const byIndex = new Map((plan?.days ?? []).map((d) => [d.dayIndex, d]));
    return Array.from({ length: dayCount }, (_, dayIndex) => {
      const real = byIndex.get(dayIndex);
      return {
        dayIndex,
        date: real?.date ?? addDays(dayIndex, startParsed),
        meals: real ? real.meals : null,
      };
    });
  }, [plan, dayCount, startDate]);

  const placeholderSlotCount = Math.max(1, controls.slots.length);

  // Single IntersectionObserver driving the jump rail's `aria-current` (plan §5.2).
  // jsdom has no IntersectionObserver, so this is a guarded progressive enhancement —
  // explicit rail clicks and keyboard navigation set `activeDayIndex` directly and
  // work regardless.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible) return;
        const idx = Number(visible.target.getAttribute("data-day-index"));
        if (!Number.isNaN(idx)) setActiveDayIndex(idx);
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [dayViewModels.length]);

  const jumpToDay = useCallback((dayIndex: number, focusHeading: boolean) => {
    setActiveDayIndex(dayIndex);
    const el = sectionRefs.current.get(dayIndex);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    el?.scrollIntoView?.({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    if (focusHeading) headingRefs.current.get(dayIndex)?.focus();
  }, []);

  // Anchor to today on mount (or day 0 if today falls outside the window).
  useEffect(() => {
    if (hasAnchoredRef.current || dayViewModels.length === 0) return;
    const todayModel = dayViewModels.find((d) => d.date === todayIso);
    const target = todayModel ?? dayViewModels[0];
    if (!target) return;
    hasAnchoredRef.current = true;
    jumpToDay(target.dayIndex, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayViewModels]);

  // Home/End/PageUp/PageDown move between days AND move focus to the day heading
  // (plan §5.2). Attached imperatively (not as a JSX `onKeyDown` prop) so the
  // day-stack container never needs to masquerade as an interactive element —
  // it's a keyboard-shortcut region, not a widget, and this keeps
  // `jsx-a11y/no-static-element-interactions` honest.
  const activeDayIndexRef = useRef(activeDayIndex);
  useEffect(() => {
    activeDayIndexRef.current = activeDayIndex;
  }, [activeDayIndex]);

  useEffect(() => {
    const el = dayStackRef.current;
    if (!el) return;
    const handler = (event: KeyboardEvent) => {
      if (!NAV_KEYS.has(event.key) || dayViewModels.length === 0) return;
      event.preventDefault();
      const lastIndex = dayViewModels[dayViewModels.length - 1]?.dayIndex ?? 0;
      const current = activeDayIndexRef.current;
      let next = current;
      if (event.key === "Home") next = dayViewModels[0]?.dayIndex ?? 0;
      else if (event.key === "End") next = lastIndex;
      else if (event.key === "PageDown") next = Math.min(current + 1, lastIndex);
      else if (event.key === "PageUp") next = Math.max(current - 1, 0);
      jumpToDay(next, true);
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [dayViewModels, jumpToDay]);

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  // Recipe sheet: route-backed, MealPlanPage stays mounted (plan §5.3).
  const activeMeal: MealPlanMealDetail | null = useMemo(() => {
    if (!recipeId || !plan) return null;
    for (const day of plan.days) {
      const found = day.meals.find((m) => m.id === recipeId);
      if (found) return found;
    }
    return null;
  }, [recipeId, plan]);

  const activeMealDay = useMemo(() => {
    if (!recipeId || !plan) return null;
    return plan.days.find((day) => day.meals.some((m) => m.id === recipeId)) ?? null;
  }, [recipeId, plan]);

  const recipeDayLabel =
    activeMeal && activeMealDay
      ? `${formatMealPlanDayHeading(activeMealDay.date)} · ${SLOT_LABELS[activeMeal.slot]}`
      : null;

  const handleRecipeOpenChange = (open: boolean) => {
    if (open) return;
    // A cold deep link (no prior in-app history) must not blindly navigate(-1) —
    // that would exit the app entirely (plan §5.3).
    if (location.key === "default") navigate("/meal-plan", { replace: true });
    else navigate(-1);
  };

  const generateProps = {
    slots: controls.slots,
    onToggleSlot: controls.toggleSlot,
    prioritizeExpiring: controls.mode === "expiring_first",
    onPrioritizeExpiringChange: (value: boolean) =>
      controls.setMode(value ? "expiring_first" : "balanced"),
    includeExpired: controls.includeExpired,
    onIncludeExpiredChange: controls.setIncludeExpired,
    totalItems,
    expiringCount,
    expiredCount,
    isGenerating,
    isStarting: generation.isStarting,
    onGenerate: generation.start,
    startDate: todayIso,
  };

  const planUsedSlots = plan ? usedSlots(plan.days) : [];

  return (
    <AppShell
      sidebarProps={{ user, onLogout: handleLogout, activeRoute: "mealPlan" }}
      mobileTopBarProps={{ inviteCode: household?.inviteCode, onLogout: handleLogout }}
    >
      <main className="flex-1 px-4 pb-24 pt-4 md:overflow-y-auto md:p-6 md:pb-6">
        <h1 className="text-2xl font-bold tracking-tight">Meal Plan</h1>

        {isDiscovering ? (
          <div aria-busy="true" aria-label="Loading your meal plan" className="mt-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : !hasKey && !planExists ? (
          <div className="mt-6">
            <AiSetupPrompt />
          </div>
        ) : !planExists ? (
          <div className="mt-6">
            <MealPlanEmptyState {...generateProps} />
          </div>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {!isGenerating &&
                  plan &&
                  planUsedSlots.map((slot) => (
                    <Badge key={slot} variant="outline">
                      {SLOT_LABELS[slot]}
                    </Badge>
                  ))}
                {!isGenerating && plan && (
                  <Badge variant="outline">
                    {plan.mode === "expiring_first" ? "Prioritizing expiring food" : "Balanced"}
                  </Badge>
                )}
                {!isGenerating && plan?.includeExpired && (
                  <Badge variant="outline">Includes expired items</Badge>
                )}
              </div>
              {hasKey && !isGenerating && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewPlanControls((v) => !v)}
                >
                  {showNewPlanControls ? "Cancel" : "Generate new plan"}
                </Button>
              )}
            </div>

            {showNewPlanControls && (
              <div className="mt-3 rounded-xl border bg-card p-4">
                <GeneratePlanControls {...generateProps} />
              </div>
            )}

            {displayError && (
              <div
                role="alert"
                className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                <span>{displayError.message}</span>
                {displayError.kind === "invalidApiKey" && (
                  <Link to="/settings#ai" className="shrink-0 font-medium underline">
                    Go to Settings
                  </Link>
                )}
              </div>
            )}

            {isGenerating && (
              <div className="mt-4">
                <GenerationProgress
                  progressDone={generation.progressDone}
                  progressTotal={generation.progressTotal}
                  onCancel={generation.cancel}
                  isCancelling={generation.isCancelling}
                />
              </div>
            )}

            {!isGenerating && plan && buyListSummary.totalIngredients > 0 && (
              <button
                type="button"
                onClick={() => setShoppingSheetOpen(true)}
                className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium hover:bg-accent md:w-auto"
              >
                <span className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {buyListSummary.totalIngredients} ingredient
                  {buyListSummary.totalIngredients === 1 ? "" : "s"} · {buyListSummary.toBuyCount}{" "}
                  to buy
                </span>
              </button>
            )}

            <DayRail
              days={dayViewModels}
              activeDayIndex={activeDayIndex}
              onJump={(i) => jumpToDay(i, false)}
            />

            <div ref={dayStackRef} className="mt-2 space-y-6">
              {dayViewModels.map((day) => (
                <DaySection
                  key={day.dayIndex}
                  dayIndex={day.dayIndex}
                  date={day.date}
                  meals={day.meals}
                  placeholderCount={placeholderSlotCount}
                  isToday={day.date === todayIso}
                  toBuyCount={toBuyByDay.get(day.dayIndex)}
                  onRetryMeal={handleRetryMeal}
                  retryingMealId={
                    mutations.regenerateMealMutation.isPending
                      ? (mutations.regenerateMealMutation.variables?.mealId ?? null)
                      : null
                  }
                  sectionRef={(el) => {
                    if (el) sectionRefs.current.set(day.dayIndex, el);
                    else sectionRefs.current.delete(day.dayIndex);
                  }}
                  headingRef={(el) => {
                    if (el) headingRefs.current.set(day.dayIndex, el);
                    else headingRefs.current.delete(day.dayIndex);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </main>

      <RecipeSheet
        open={!!recipeId}
        onOpenChange={handleRecipeOpenChange}
        meal={activeMeal}
        dayLabel={recipeDayLabel}
        onRetry={handleRetryMeal}
        isRetrying={activeMeal ? isRetryingMeal(activeMeal.id) : false}
      />

      <PlanShoppingSheet
        open={shoppingSheetOpen}
        onOpenChange={(open) => {
          setShoppingSheetOpen(open);
          if (!open) setShoppingStatusMessage(null);
        }}
        aggregates={buyListAggregates}
        startDate={startDate}
        onCommit={handleCommitShopping}
        isCommitting={mutations.commitShoppingMutation.isPending}
        statusMessage={shoppingStatusMessage}
        onToggleIngredientSource={handleToggleIngredientSource}
        isTogglingSource={mutations.toggleIngredientSourceMutation.isPending}
      />
    </AppShell>
  );
}
