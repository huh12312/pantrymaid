import { Button } from "@/components/ui/button";

export interface GenerationProgressProps {
  progressDone: number;
  progressTotal: number;
  onCancel: () => void;
  isCancelling: boolean;
}

/**
 * The ONE `role="status" aria-live="polite"` for the whole generation UX (plan
 * §5.5) — progress is meal-denominated ("18 of 28"), never day-denominated, and
 * announcing every meal completion (rather than per-token) is deliberate: frequent
 * enough to feel alive, not so frequent it floods a screen reader. Cancel is
 * always visible while this is mounted.
 */
export function GenerationProgress({
  progressDone,
  progressTotal,
  onCancel,
  isCancelling,
}: GenerationProgressProps) {
  const pct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="font-medium">Generating your meal plan…</p>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isCancelling}>
          {isCancelling ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        {progressTotal > 0 ? `${progressDone} of ${progressTotal} meals ready` : "Getting started…"}
      </p>
    </div>
  );
}
