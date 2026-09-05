import { Check, RotateCcw, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { colorMap } from "@/lib/inventoryColors";
import { cn } from "@/lib/utils";
import { formatUsedOnChip, type MealPlanIngredientAggregate } from "@/lib/mealPlanIngredients";
import type { IngredientSource } from "@/lib/api";

export interface IngredientRowProps {
  aggregate: MealPlanIngredientAggregate;
  /** The plan's `startDate` — needed to turn a `usedOn` dayIndex into a weekday label. */
  startDate: string;
  /** Only meaningful (and only rendered as a checkbox) when `aggregate.status === "must_buy"`. */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Already present on the household's pending shopping list under this normalized name. */
  alreadyPending: boolean;
  /**
   * Flips this ingredient's persisted have/buy classification (plan §5.4) — the only
   * UI path to correct a stale `source` that disagrees with live inventory, short of
   * deleting and regenerating the whole plan. Called with EVERY underlying
   * `MealPlanIngredient.id` this row represents (an aggregate can span several
   * meals/days) and the `IngredientSource` to flip them all to.
   */
  onToggleSource: (ingredientIds: string[], nextSource: IngredientSource) => void;
  /** Disables the toggle control while a flip is in flight (mirrors `isCommitting`). */
  isTogglingSource?: boolean;
}

function StatusBadge({ aggregate }: { aggregate: MealPlanIngredientAggregate }) {
  // Status is always icon + text label together — never colour alone (WCAG 1.4.1).
  switch (aggregate.status) {
    case "have":
      return (
        <Badge variant="secondary" className="shrink-0">
          <Check className="h-3 w-3" aria-hidden="true" /> Have it
        </Badge>
      );
    case "have_expiring":
      return (
        <Badge variant="warning" className="shrink-0">
          <Check className="h-3 w-3" aria-hidden="true" />{" "}
          {aggregate.expiryLabel ?? "Expiring soon"}
        </Badge>
      );
    case "must_buy":
    default:
      return (
        <Badge variant="default" className="shrink-0">
          <ShoppingCart className="h-3 w-3" aria-hidden="true" /> Must buy
        </Badge>
      );
  }
}

/**
 * Flips an ingredient's have/buy classification the other way (plan §5.4). Rendered
 * for EVERY row — must-buy rows can be marked "already have it" just as much as
 * have/have-expiring rows can be marked "needs purchase" — because the persisted
 * `source` can disagree with live inventory in either direction, and without this the
 * only fix was deleting and regenerating the whole plan. A real `<button>` (not an
 * icon with no accessible name) with a direction-specific label, and a 44px touch
 * target even though the visual icon is smaller (WCAG 2.5.5).
 */
function ToggleSourceButton({
  aggregate,
  onToggleSource,
  disabled,
}: {
  aggregate: MealPlanIngredientAggregate;
  onToggleSource: (ingredientIds: string[], nextSource: IngredientSource) => void;
  disabled: boolean;
}) {
  const markAsBuy = aggregate.status !== "must_buy";
  const nextSource: IngredientSource = markAsBuy ? "purchase" : "pantry";
  const label = markAsBuy
    ? `Mark ${aggregate.displayName} as needing purchase`
    : `Mark ${aggregate.displayName} as already have it`;

  return (
    <button
      type="button"
      onClick={() => onToggleSource(aggregate.ingredientIds, nextSource)}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      {markAsBuy ? (
        <ShoppingCart className="h-4 w-4" aria-hidden="true" />
      ) : (
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * One aggregated ingredient row inside `PlanShoppingSheet` (plan §5.4). Must-buy rows
 * get a checkbox (pre-checked by the caller); have/have-expiring rows show a read-only
 * status icon instead. Every row ALSO gets a `ToggleSourceButton` so any row's have/buy
 * classification can be corrected regardless of status. The checkbox's own hit target
 * is 44px even though the visual control is smaller (WCAG 2.5.5 / the mobile
 * touch-target requirement in the plan).
 */
export function IngredientRow({
  aggregate,
  startDate,
  checked,
  onCheckedChange,
  alreadyPending,
  onToggleSource,
  isTogglingSource = false,
}: IngredientRowProps) {
  const checkboxId = `mealplan-buy-${aggregate.nameNormalized}`;
  const usedOnLabel = aggregate.usedOn
    .map((usage) => formatUsedOnChip(usage, startDate))
    .join(", ");
  const isExpiring = aggregate.status === "have_expiring";

  return (
    <li className="flex items-start gap-3 rounded-xl border bg-card px-3 py-2.5">
      {aggregate.status === "must_buy" ? (
        <label
          htmlFor={checkboxId}
          className="flex h-11 w-11 shrink-0 -m-1 items-center justify-center"
        >
          <Checkbox
            id={checkboxId}
            checked={checked}
            onCheckedChange={(value) => onCheckedChange(value === true)}
            aria-label={`Add ${aggregate.displayName} to the re-order list`}
          />
        </label>
      ) : (
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            isExpiring ? colorMap.amber : "text-muted-foreground"
          )}
          aria-hidden="true"
        >
          <Check className="h-3.5 w-3.5" />
        </span>
      )}

      <div className="min-w-0 flex-1 py-1">
        <p className="truncate text-sm font-medium">{aggregate.displayName}</p>
        <p className="text-xs text-muted-foreground">{aggregate.quantityLabel}</p>
        {usedOnLabel && <p className="truncate text-xs text-muted-foreground">{usedOnLabel}</p>}
        {alreadyPending && (
          <p className="text-xs italic text-muted-foreground">Already on your re-order list</p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 py-1">
        <StatusBadge aggregate={aggregate} />
        <ToggleSourceButton
          aggregate={aggregate}
          onToggleSource={onToggleSource}
          disabled={isTogglingSource}
        />
      </div>
    </li>
  );
}
