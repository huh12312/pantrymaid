import { Link } from "react-router-dom";
import { Clock, Users, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MealPlanMealDetail } from "@/lib/api";

export interface MealCardPlaceholderProps {
  variant: "placeholder";
  /** Distinguishes a skeleton for testing/keys; not rendered. */
  slotLabel?: string;
}

export interface MealCardMealProps {
  variant: "meal";
  meal: MealPlanMealDetail;
  /** `<h3>` for a single-slot day, `<h4>` when grouped under a slot `<h3>` (plan §11.1). */
  titleAs: "h3" | "h4";
  onRetry: (mealId: string) => void;
  isRetrying: boolean;
}

export type MealCardProps = MealCardPlaceholderProps | MealCardMealProps;

/**
 * A meal in the day stack. ALWAYS a real `<a>` (via `Link`) when it links to the
 * recipe sheet, or contains a real `<button>` for retry — never a clickable `<div>`
 * (plan §5.2/§5.9, axe-gated in `e2e/a11y.spec.ts`).
 */
export function MealCard(props: MealCardProps) {
  if (props.variant === "placeholder") {
    return (
      <div
        aria-hidden="true"
        className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none md:h-32"
      />
    );
  }

  const { meal, titleAs: TitleTag, onRetry, isRetrying } = props;

  if (meal.detailStatus === "failed") {
    return (
      <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <TitleTag className="text-base font-semibold">{meal.title}</TitleTag>
        <p role="alert" className="text-sm text-destructive">
          {meal.detailError ?? "This recipe's details couldn't be generated."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRetry(meal.id)}
          disabled={isRetrying}
        >
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isRetrying && "animate-spin")} />
          {isRetrying ? "Retrying…" : "Retry this recipe"}
        </Button>
      </div>
    );
  }

  const isPending = meal.detailStatus === "pending";
  const totalMinutes = (meal.prepMinutes ?? 0) + (meal.cookMinutes ?? 0);

  return (
    <Link
      to={`/meal-plan/recipe/${meal.id}`}
      className="block min-h-[44px] rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TitleTag className="text-base font-semibold leading-snug">{meal.title}</TitleTag>
      {meal.summary && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{meal.summary}</p>
      )}
      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
        {isPending ? (
          <span className="animate-pulse motion-reduce:animate-none">Preparing recipe…</span>
        ) : (
          <>
            {totalMinutes > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {totalMinutes} min
              </span>
            )}
            {meal.servings && (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                Serves {meal.servings}
              </span>
            )}
          </>
        )}
      </div>
    </Link>
  );
}
