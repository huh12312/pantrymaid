import { Clock, Users, Check, ShoppingCart, Wheat, RefreshCw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RecipeInstructions } from "./RecipeInstructions";
import type { MealPlanMealDetail, IngredientSource } from "@/lib/api";

export interface RecipeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meal: MealPlanMealDetail | null;
  /** e.g. "Monday, Sep 8 · Dinner" — shown in the meta row when known. */
  dayLabel: string | null;
  onRetry: (mealId: string) => void;
  isRetrying: boolean;
}

function ingredientBadge(source: IngredientSource) {
  switch (source) {
    case "pantry":
      return (
        <Badge variant="secondary" className="shrink-0">
          <Check className="h-3 w-3" aria-hidden="true" /> Have it
        </Badge>
      );
    case "staple":
      return (
        <Badge variant="outline" className="shrink-0">
          <Wheat className="h-3 w-3" aria-hidden="true" /> Staple
        </Badge>
      );
    case "purchase":
    default:
      return (
        <Badge variant="default" className="shrink-0">
          <ShoppingCart className="h-3 w-3" aria-hidden="true" /> Buy
        </Badge>
      );
  }
}

/**
 * Route-backed bottom sheet for a single recipe (plan §5.3). `open`/`onOpenChange`
 * are driven entirely by the caller (`MealPlanPage`, keyed off `/meal-plan/recipe/:id`)
 * so this component owns no navigation logic itself — including the
 * cold-deep-link-vs-back-navigation close behavior, which lives in the page.
 */
export function RecipeSheet({
  open,
  onOpenChange,
  meal,
  dayLabel,
  onRetry,
  isRetrying,
}: RecipeSheetProps) {
  const totalMinutes = meal ? (meal.prepMinutes ?? 0) + (meal.cookMinutes ?? 0) : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{meal?.title ?? "Recipe"}</SheetTitle>
          <SheetDescription className={meal ? "sr-only" : undefined}>
            {meal
              ? `Full recipe details for ${meal.title}${dayLabel ? `, ${dayLabel}` : ""}.`
              : "This recipe couldn't be found. It may belong to a different plan."}
          </SheetDescription>
        </SheetHeader>

        {meal ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {dayLabel && <span>{dayLabel}</span>}
              {totalMinutes > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  {totalMinutes} min
                </span>
              )}
              {meal.servings && (
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Serves {meal.servings}
                </span>
              )}
            </div>

            {meal.ingredients && meal.ingredients.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Ingredients</h3>
                <ul className="space-y-2">
                  {meal.ingredients.map((ing) => (
                    <li key={ing.id} className="flex items-center justify-between gap-3 text-sm">
                      <span>{ing.rawText}</span>
                      {ingredientBadge(ing.source)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-semibold">Steps</h3>
              <RecipeInstructions
                status={meal.detailStatus}
                steps={meal.instructions}
                detailError={meal.detailError}
              />
            </div>

            {meal.detailStatus === "failed" && (
              <SheetFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onRetry(meal.id)}
                  disabled={isRetrying}
                >
                  <RefreshCw className={cn("mr-2 h-4 w-4", isRetrying && "animate-spin")} />
                  {isRetrying ? "Retrying…" : "Retry this recipe"}
                </Button>
              </SheetFooter>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
