import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IngredientRow } from "./IngredientRow";
import { api, type IngredientSource, type ShoppingListItem } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import {
  groupAggregatesByStatus,
  normalizeIngredientName,
  type MealPlanIngredientAggregate,
} from "@/lib/mealPlanIngredients";

// A stable reference (not a fresh `[]` literal) for the `useQuery` default below — a
// literal default is a NEW array every render, which would make `alreadyPendingNames`
// (memoized off it) change identity every render too, and cascade into an infinite
// `useEffect` loop with the pre-check effect further down.
const EMPTY_SHOPPING_LIST: ShoppingListItem[] = [];

export interface PlanShoppingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aggregates: MealPlanIngredientAggregate[];
  startDate: string;
  /** `requestedCount` is the number of DISTINCT checked ingredient names (matching the
   * "Add N to Re-order List" button label) — not `ingredientIds.length`, since one
   * ingredient name can span several underlying rows. The caller uses it to tell a
   * partial commit (some names were already pending) from a full one. */
  onCommit: (ingredientIds: string[], requestedCount: number) => void;
  isCommitting: boolean;
  /** Announced via the one `role="status"` for this surface (plan §5.4 a11y). */
  statusMessage: string | null;
  /** Flips every ingredient a row represents to `nextSource` (plan §5.4 — the have/buy
   * classification fix-up path). Forwarded straight to each `IngredientRow`. */
  onToggleIngredientSource: (ingredientIds: string[], nextSource: IngredientSource) => void;
  /** Disables every row's toggle control while a flip is in flight. */
  isTogglingSource?: boolean;
}

/**
 * Full buy-list sheet (plan §5.4), mirroring the existing re-order sheet
 * (`InventoryPage.tsx` "Re-order List" `Sheet side="right"`). Must-buy rows are
 * pre-checked; toggling reflects into local state only (the aggregation itself is
 * never re-derived here — it's computed once by the caller and handed down, per the
 * plan §5.8 cache rule).
 *
 * Dedupe: fetches the household's live pending shopping list (`queryKeys.shoppingList.
 * lists()` — the SAME cache key the Inventory page's re-order sheet reads) and excludes
 * any ingredient already pending, by normalized name, from the default pre-checked set.
 * This is what makes re-opening the sheet after a commit not re-check (and so not
 * re-add) items that are already on the list.
 */
export function PlanShoppingSheet({
  open,
  onOpenChange,
  aggregates,
  startDate,
  onCommit,
  isCommitting,
  statusMessage,
  onToggleIngredientSource,
  isTogglingSource = false,
}: PlanShoppingSheetProps) {
  const { data: shoppingListItems = EMPTY_SHOPPING_LIST } = useQuery({
    queryKey: queryKeys.shoppingList.lists(),
    queryFn: () => api.getShoppingList(),
    enabled: open,
  });

  const alreadyPendingNames = useMemo(
    () => new Set(shoppingListItems.map((item) => normalizeIngredientName(item.name))),
    [shoppingListItems]
  );

  const grouped = useMemo(() => groupAggregatesByStatus(aggregates), [aggregates]);
  const mustBuy = useMemo(
    () => grouped.find((g) => g.status === "must_buy")?.items ?? [],
    [grouped]
  );

  const [checkedNames, setCheckedNames] = useState<Set<string>>(new Set());

  // Re-derive the pre-checked set every time the sheet opens, so a prior commit (or a
  // newly-pending item added elsewhere) is reflected rather than showing stale checks.
  useEffect(() => {
    if (!open) return;
    setCheckedNames(
      new Set(
        mustBuy
          .filter((item) => !alreadyPendingNames.has(item.nameNormalized))
          .map((item) => item.nameNormalized)
      )
    );
  }, [open, mustBuy, alreadyPendingNames]);

  // The button label counts distinct CHECKED INGREDIENTS ("Add 6...", matching the
  // summary bar's "N to buy" semantics) — not the raw underlying ingredient row ids,
  // which is what actually gets sent to the commit mutation (one ingredient can span
  // several rows across meals/days).
  const selectedAggregates = useMemo(
    () => mustBuy.filter((item) => checkedNames.has(item.nameNormalized)),
    [mustBuy, checkedNames]
  );
  const selectedIngredientIds = useMemo(
    () => selectedAggregates.flatMap((item) => item.ingredientIds),
    [selectedAggregates]
  );

  const toggleChecked = (nameNormalized: string, value: boolean) => {
    setCheckedNames((prev) => {
      const next = new Set(prev);
      if (value) next.add(nameNormalized);
      else next.delete(nameNormalized);
      return next;
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        <SheetHeader className="shrink-0 border-b px-4 py-4">
          <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart className="h-4 w-4 shrink-0" aria-hidden="true" />
            Buy List
          </SheetTitle>
          <SheetDescription className="sr-only">
            Ingredients needed for this meal plan, grouped by whether you already have them.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {aggregates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ingredients yet.</p>
          ) : (
            <div className="space-y-6">
              {grouped.map(
                (group) =>
                  group.items.length > 0 && (
                    <section key={group.status}>
                      <h3 className="mb-2 text-sm font-semibold">{group.label}</h3>
                      <ul className="space-y-2">
                        {group.items.map((aggregate) => (
                          <IngredientRow
                            key={aggregate.nameNormalized}
                            aggregate={aggregate}
                            startDate={startDate}
                            checked={checkedNames.has(aggregate.nameNormalized)}
                            onCheckedChange={(value) =>
                              toggleChecked(aggregate.nameNormalized, value)
                            }
                            alreadyPending={alreadyPendingNames.has(aggregate.nameNormalized)}
                            onToggleSource={onToggleIngredientSource}
                            isTogglingSource={isTogglingSource}
                          />
                        ))}
                      </ul>
                    </section>
                  )
              )}
            </div>
          )}
        </div>

        <SheetFooter className="shrink-0 flex-col gap-2 border-t p-4 sm:flex-col sm:space-x-0">
          <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
            {statusMessage}
          </p>
          <Button
            type="button"
            className="w-full"
            disabled={selectedAggregates.length === 0 || isCommitting}
            onClick={() => onCommit(selectedIngredientIds, selectedAggregates.length)}
          >
            {isCommitting ? "Adding…" : `Add ${selectedAggregates.length} to Re-order List`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
