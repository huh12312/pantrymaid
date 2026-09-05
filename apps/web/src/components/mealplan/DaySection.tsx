import { Badge } from "@/components/ui/badge";
import { SLOT_LABELS, sortMealsBySlot, formatMealPlanDayHeading } from "@/lib/mealPlanControls";
import { MealCard } from "./MealCard";
import type { MealPlanMealDetail } from "@/lib/api";

export interface DaySectionProps {
  dayIndex: number;
  date: string;
  /** null while the skeleton phase hasn't produced this day yet — renders placeholders. */
  meals: MealPlanMealDetail[] | null;
  /** Number of skeleton cards to show while `meals` is null. */
  placeholderCount: number;
  isToday: boolean;
  onRetryMeal: (mealId: string) => void;
  retryingMealId: string | null;
  sectionRef: (el: HTMLElement | null) => void;
  headingRef: (el: HTMLHeadingElement | null) => void;
  /** Must-buy ingredient count touching this day (`lib/mealPlanIngredients.ts`'s
   * `toBuyCountsByDay`, plan §5.2/§5.4). Omitted or 0 renders nothing. */
  toBuyCount?: number;
}

/**
 * One day in the vertical day-stack (plan §5.2). A real `<section
 * aria-labelledby>` with a sticky `<h2>` header; `scroll-mt-*` keeps the sticky
 * mobile top bar + jump rail from eclipsing the heading when jumped/anchored to.
 */
export function DaySection({
  dayIndex,
  date,
  meals,
  placeholderCount,
  isToday,
  onRetryMeal,
  retryingMealId,
  sectionRef,
  headingRef,
  toBuyCount,
}: DaySectionProps) {
  const headingId = `meal-plan-day-${dayIndex}-heading`;
  const sortedMeals = meals ? sortMealsBySlot(meals) : null;
  const isMultiSlot = (sortedMeals?.length ?? 0) > 1;

  return (
    <section
      id={`meal-plan-day-${dayIndex}`}
      aria-labelledby={headingId}
      data-day-index={dayIndex}
      ref={sectionRef}
      className="scroll-mt-32 md:scroll-mt-16"
    >
      <div className="sticky top-[calc(4rem_+_3rem)] z-20 -mx-4 bg-background/95 px-4 py-2 backdrop-blur md:top-0 md:-mx-6 md:px-6">
        <div className="flex items-center gap-2">
          <h2
            id={headingId}
            tabIndex={-1}
            ref={headingRef}
            className="text-lg font-semibold outline-none"
          >
            {formatMealPlanDayHeading(date)}
          </h2>
          {isToday && <Badge variant="default">Today</Badge>}
          {typeof toBuyCount === "number" && toBuyCount > 0 && (
            <Badge variant="outline">{toBuyCount} to buy</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 py-3 md:grid-cols-3 md:gap-4">
        {sortedMeals === null &&
          Array.from({ length: Math.max(1, placeholderCount) }).map((_, i) => (
            <MealCard key={i} variant="placeholder" />
          ))}

        {sortedMeals !== null && sortedMeals.length === 0 && (
          <p className="text-sm text-muted-foreground">No meals planned for this day.</p>
        )}

        {sortedMeals !== null &&
          sortedMeals.map((meal) =>
            isMultiSlot ? (
              <div key={meal.id} className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {SLOT_LABELS[meal.slot]}
                </h3>
                <MealCard
                  variant="meal"
                  meal={meal}
                  titleAs="h4"
                  onRetry={onRetryMeal}
                  isRetrying={retryingMealId === meal.id}
                />
              </div>
            ) : (
              <MealCard
                key={meal.id}
                variant="meal"
                meal={meal}
                titleAs="h3"
                onRetry={onRetryMeal}
                isRetrying={retryingMealId === meal.id}
              />
            )
          )}
      </div>
    </section>
  );
}
