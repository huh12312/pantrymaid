import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type CreateMealPlanInput,
  type MealPlanDetail,
  type MealPlanGenerationErrorCode,
  type MealPlanStatus,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Statuses under which a plan is still being worked on by the server (plan §4.1).
 * `queued` is included even though it isn't literally `generating_*` — nothing has
 * started producing meals yet, but the job is live and must still be polled/re-attached.
 */
export const GENERATING_MEAL_PLAN_STATUSES: readonly MealPlanStatus[] = [
  "queued",
  "generating_skeleton",
  "generating_recipes",
];

export function isGeneratingMealPlanStatus(
  status: MealPlanStatus | null | undefined
): status is "queued" | "generating_skeleton" | "generating_recipes" {
  return status != null && (GENERATING_MEAL_PLAN_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether `getMealPlan(id)` should keep being polled. True while the plan itself is
 * generating, AND (plan §4.4 is silent on a dedicated polling contract for this, so this
 * is a deliberate extension) while any individual meal is mid single-meal regeneration —
 * `POST .../meals/:mealId/regenerate` flips that meal's `detailStatus` to `"pending"`
 * without changing the plan's own `status`, so polling driven by plan status alone would
 * never pick up the result.
 */
export function planNeedsPolling(plan: MealPlanDetail | null | undefined): boolean {
  if (!plan) return false;
  if (isGeneratingMealPlanStatus(plan.status)) return true;
  return plan.days.some((day) => day.meals.some((meal) => meal.detailStatus === "pending"));
}

/**
 * Friendlier, UI-facing grouping of `MealPlanGenerationErrorCode` (plan §5.5: "key
 * rejected ... rate-limited, timeout, unusable model output" must be messaged
 * separately). NOTE: the persisted `errorCode` enum on the plan row has no distinct
 * terminal "rate limited" value — `server/src/lib/mealplan/generate.ts` retries 429s
 * with backoff, and only writes `provider_unavailable` if those retries are exhausted.
 * So a plan that failed *because* of sustained rate limiting is indistinguishable, from
 * this API alone, from any other provider outage — both surface as `providerUnavailable`
 * here. If product wants a dedicated "you got rate-limited" message, that requires a
 * backend change (a distinct persisted error code), not a frontend one.
 */
export type MealPlanGenerationErrorKind =
  | "invalidApiKey"
  | "providerUnavailable"
  | "unusableOutput"
  | "timeout"
  | "interrupted"
  | "unknown";

export interface MealPlanGenerationError {
  kind: MealPlanGenerationErrorKind;
  /** The raw code as persisted on the plan row, when recognized; null otherwise. */
  code: MealPlanGenerationErrorCode | null;
  /** Stable, ready-to-render message. Prefer this over `code`/`kind` for display. */
  message: string;
}

const KNOWN_ERROR_CODES = new Set<MealPlanGenerationErrorCode>([
  "invalid_api_key",
  "provider_unavailable",
  "unparseable_output",
  "timeout",
  "cancelled",
  "interrupted",
]);

const ERROR_CODE_TO_KIND: Record<MealPlanGenerationErrorCode, MealPlanGenerationErrorKind | null> =
  {
    invalid_api_key: "invalidApiKey",
    provider_unavailable: "providerUnavailable",
    unparseable_output: "unusableOutput",
    timeout: "timeout",
    interrupted: "interrupted",
    // Cancellation is user-initiated, not a failure state to message as an error.
    cancelled: null,
  };

const ERROR_KIND_MESSAGES: Record<MealPlanGenerationErrorKind, string> = {
  invalidApiKey: "Your AI provider rejected the stored API key. Update it in Settings.",
  providerUnavailable:
    "The AI provider is temporarily unavailable or busy. Wait a few minutes and try again.",
  unusableOutput: "The AI model's response couldn't be used. Try generating again.",
  timeout: "The request to the AI provider timed out. Try again.",
  interrupted: "Generation was interrupted by a server restart. Start a new plan.",
  unknown: "Meal plan generation failed.",
};

/**
 * Derives a distinct, display-ready error from a failed plan's `status`/`errorCode`/
 * `errorMessage`. Returns null when the plan hasn't failed (including `cancelled`,
 * which is a distinct terminal status, not an error).
 */
export function classifyMealPlanError(
  plan: Pick<MealPlanDetail, "status" | "errorCode" | "errorMessage"> | null | undefined
): MealPlanGenerationError | null {
  if (!plan || plan.status !== "failed") return null;
  const rawCode = plan.errorCode;
  const code =
    rawCode && KNOWN_ERROR_CODES.has(rawCode as MealPlanGenerationErrorCode)
      ? (rawCode as MealPlanGenerationErrorCode)
      : null;
  const kind = code ? (ERROR_CODE_TO_KIND[code] ?? "unknown") : "unknown";
  return {
    kind,
    code,
    message: plan.errorMessage ?? ERROR_KIND_MESSAGES[kind],
  };
}

export interface UseMealPlanGenerationOptions {
  /**
   * Track this specific plan id instead of discovering the household's most recent
   * plan. Useful when a route already carries a plan id (e.g. a deep link). When
   * omitted, the hook looks up the most recent plan on mount and re-attaches to it
   * automatically if it is still generating (plan §5.5).
   */
  planId?: string;
}

export interface UseMealPlanGenerationResult {
  /** The plan currently tracked (freshly started, re-attached, or passed via options), or null. */
  planId: string | null;
  /** Full nested plan (days -> meals -> ingredients) once fetched; null until then. */
  plan: MealPlanDetail | null;
  /** Convenience mirror of `plan?.status`. */
  status: MealPlanStatus | null;
  /** True while status is `queued` / `generating_skeleton` / `generating_recipes`. */
  isGenerating: boolean;
  /** Meal-denominated progress — never day-denominated (plan §11.1). */
  progressDone: number;
  progressTotal: number;
  /** Set only when `status === "failed"`; distinguishes failure reasons for messaging. */
  error: MealPlanGenerationError | null;
  /** True while discovering a plan to re-attach to, or loading the tracked plan for the first time. */
  isAttaching: boolean;
  /** Enqueues a new generation (202) and starts tracking it immediately. */
  start: (input: CreateMealPlanInput) => void;
  isStarting: boolean;
  /** Set when `start` itself fails (e.g. 409 already-generating, 400 no API key configured). */
  startError: string | null;
  /** Cancels the tracked plan. No-op if nothing is tracked. */
  cancel: () => void;
  isCancelling: boolean;
}

/**
 * Owns the full generation lifecycle for one meal plan: kicking off `POST
 * /api/meal-plans`, polling `GET /api/meal-plans/:id` via `refetchInterval` (2s while
 * generating, off once terminal — no hand-rolled `setInterval`), re-attaching to an
 * already-running generation on mount, and cancelling.
 *
 * The job is entirely server-owned (plan §5.5): unmounting/navigating away never loses
 * progress, because the next mount re-discovers the same in-flight plan via
 * `getCurrentMealPlan` and resumes polling it.
 */
export function useMealPlanGeneration(
  options: UseMealPlanGenerationOptions = {}
): UseMealPlanGenerationResult {
  const queryClient = useQueryClient();
  const [planId, setPlanId] = useState<string | null>(options.planId ?? null);
  const hasAttachedRef = useRef(options.planId != null);

  // Discover the household's most recent plan, purely to decide whether to re-attach.
  // Disabled once a planId is known (explicitly passed, re-attached, or started) — from
  // then on the detail query below is the single source of truth.
  const currentQuery = useQuery({
    queryKey: queryKeys.mealPlan.current(null),
    queryFn: () => api.getCurrentMealPlan(),
    enabled: planId === null,
    staleTime: 0,
  });

  useEffect(() => {
    if (planId !== null || hasAttachedRef.current) return;
    const current = currentQuery.data;
    if (current && isGeneratingMealPlanStatus(current.status)) {
      hasAttachedRef.current = true;
      setPlanId(current.id);
    }
  }, [currentQuery.data, planId]);

  // `detail(planId)` is staleTime: Infinity (an immutable, generated plan) EXCEPT while
  // generating, where refetchInterval drives polling (plan §5.8). Evaluated against the
  // freshest fetched data after every fetch, so it turns itself off the moment the
  // status flips to a terminal value.
  const planQuery = useQuery({
    queryKey: planId ? queryKeys.mealPlan.detail(planId) : queryKeys.mealPlan.details(),
    queryFn: () => api.getMealPlan(planId as string),
    enabled: planId !== null,
    staleTime: Infinity,
    refetchInterval: (query) => (planNeedsPolling(query.state.data) ? 2000 : false),
  });

  const startMutation = useMutation({
    mutationFn: (input: CreateMealPlanInput) => api.createMealPlan(input),
    onSuccess: (created) => {
      hasAttachedRef.current = true;
      setPlanId(created.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.mealPlan.lists() });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!planId) return Promise.reject(new Error("No active meal plan to cancel"));
      return api.cancelMealPlan(planId);
    },
    onSuccess: (updated) => {
      if (!planId) return;
      queryClient.setQueryData<MealPlanDetail>(queryKeys.mealPlan.detail(planId), (old) =>
        old ? { ...old, ...updated } : old
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.mealPlan.lists() });
    },
  });

  const plan = planQuery.data ?? null;
  const status = plan?.status ?? null;

  const start = useCallback(
    (input: CreateMealPlanInput) => startMutation.mutate(input),
    [startMutation]
  );
  const cancel = useCallback(() => {
    if (planId) cancelMutation.mutate();
  }, [planId, cancelMutation]);

  return {
    planId,
    plan,
    status,
    isGenerating: isGeneratingMealPlanStatus(status),
    progressDone: plan?.progressDone ?? 0,
    progressTotal: plan?.progressTotal ?? 0,
    error: classifyMealPlanError(plan),
    isAttaching: planId === null ? currentQuery.isLoading : planQuery.isLoading,
    start,
    isStarting: startMutation.isPending,
    startError: startMutation.error instanceof Error ? startMutation.error.message : null,
    cancel,
    isCancelling: cancelMutation.isPending,
  };
}
