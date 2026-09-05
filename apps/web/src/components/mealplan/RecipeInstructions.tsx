import type { MealPlanDetailStatus } from "@/lib/api";

export interface RecipeInstructionsProps {
  status: MealPlanDetailStatus;
  steps: string[];
  detailError?: string | null;
}

/**
 * Numbered steps, read while cooking rather than skimmed (plan §5.3): `text-base`
 * with generous line-height, `select-text`, and never truncated.
 */
export function RecipeInstructions({ status, steps, detailError }: RecipeInstructionsProps) {
  if (status === "pending") {
    return (
      <p className="text-sm text-muted-foreground" aria-hidden={false}>
        This recipe&apos;s steps are still being generated.
      </p>
    );
  }

  if (status === "failed" || steps.length === 0) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {detailError ?? "We couldn't generate steps for this recipe."}
      </p>
    );
  }

  return (
    <ol className="list-decimal space-y-3 pl-5 text-base leading-relaxed select-text">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}
