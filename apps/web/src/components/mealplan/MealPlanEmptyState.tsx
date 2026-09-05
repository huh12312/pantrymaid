import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { GeneratePlanControls, type GeneratePlanControlsProps } from "./GeneratePlanControls";

/**
 * Key configured, but no plan yet (plan §5.7). Wraps `GeneratePlanControls` — the
 * same controls component reused for the "generate a new plan" affordance once a
 * plan already exists — with the empty-state framing.
 */
export function MealPlanEmptyState(props: GeneratePlanControlsProps) {
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CalendarDays className="h-6 w-6" aria-hidden="true" />
        </div>
        <CardTitle>Plan your week</CardTitle>
        <CardDescription>
          Generate a week of meals from your household&apos;s pantry, then see full recipes and what
          you still need to buy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GeneratePlanControls {...props} />
      </CardContent>
    </Card>
  );
}
