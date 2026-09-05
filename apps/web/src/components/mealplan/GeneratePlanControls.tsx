import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type { CreateMealPlanInput, MealSlot } from "@/lib/api";
import { SLOT_LABELS, SLOT_ORDER, estimateMealPlanGeneration } from "@/lib/mealPlanControls";

/** The plan is always generated for a full week starting today (plan §5.7 lists only
 * three per-generation controls — slot multi-select and the two toggles — so the
 * day range is deliberately not exposed as a fourth control). */
export const DEFAULT_DAY_COUNT = 7;

export interface GeneratePlanControlsProps {
  slots: MealSlot[];
  onToggleSlot: (slot: MealSlot) => void;
  prioritizeExpiring: boolean;
  onPrioritizeExpiringChange: (value: boolean) => void;
  includeExpired: boolean;
  onIncludeExpiredChange: (value: boolean) => void;
  totalItems: number;
  expiringCount: number;
  expiredCount: number;
  isGenerating: boolean;
  isStarting: boolean;
  onGenerate: (input: CreateMealPlanInput) => void;
  startDate: string;
}

export function GeneratePlanControls({
  slots,
  onToggleSlot,
  prioritizeExpiring,
  onPrioritizeExpiringChange,
  includeExpired,
  onIncludeExpiredChange,
  totalItems,
  expiringCount,
  expiredCount,
  isGenerating,
  isStarting,
  onGenerate,
  startDate,
}: GeneratePlanControlsProps) {
  const { meals, minutes } = estimateMealPlanGeneration(DEFAULT_DAY_COUNT, slots.length);
  const busy = isGenerating || isStarting;
  const canGenerate = slots.length > 0 && !busy;

  const handleGenerate = () => {
    if (!canGenerate) return;
    onGenerate({
      startDate,
      dayCount: DEFAULT_DAY_COUNT,
      slots,
      mode: prioritizeExpiring ? "expiring_first" : "balanced",
      includeExpired,
    });
  };

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Which meals?</legend>
        <div className="flex flex-wrap gap-4">
          {SLOT_ORDER.map((slot) => {
            const inputId = `meal-plan-slot-${slot}`;
            return (
              <div key={slot} className="flex items-center gap-2">
                <Checkbox
                  id={inputId}
                  checked={slots.includes(slot)}
                  onCheckedChange={() => onToggleSlot(slot)}
                  disabled={busy}
                />
                <Label htmlFor={inputId} className="cursor-pointer font-normal">
                  {SLOT_LABELS[slot]}
                </Label>
              </div>
            );
          })}
        </div>
        {slots.length === 0 ? (
          <p className="mt-1 text-sm text-destructive">Select at least one meal.</p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {meals} meal{meals === 1 ? "" : "s"}, roughly {minutes} minute{minutes === 1 ? "" : "s"}
            .
          </p>
        )}
      </fieldset>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="meal-plan-prioritize-expiring" className="font-medium">
            Prioritize expiring food
          </Label>
          <p className="text-sm text-muted-foreground">
            {expiringCount > 0
              ? `Favors your ${expiringCount} item${expiringCount === 1 ? "" : "s"} expiring in the next 7 days.`
              : "No items are expiring soon right now."}
          </p>
        </div>
        <Switch
          id="meal-plan-prioritize-expiring"
          checked={prioritizeExpiring}
          onCheckedChange={onPrioritizeExpiringChange}
          disabled={busy}
        />
      </div>

      {/* Hidden entirely when there's nothing expired — the common case never sees
          this control (plan §5.7, §2.4). */}
      {expiredCount > 0 && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="meal-plan-include-expired" className="font-medium">
              Include expired items
            </Label>
            <p className="text-sm text-muted-foreground">
              {expiredCount} expired item{expiredCount === 1 ? "" : "s"} — many expiry dates are
              estimates.
            </p>
          </div>
          <Switch
            id="meal-plan-include-expired"
            checked={includeExpired}
            onCheckedChange={onIncludeExpiredChange}
            disabled={busy}
          />
        </div>
      )}

      {totalItems === 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Your pantry is empty, so this plan will be mostly a shopping list. Add items first for
          better results.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          We&apos;ll use {totalItems} pantry item{totalItems === 1 ? "" : "s"}
          {expiringCount > 0 ? `, ${expiringCount} expiring soon` : ""}.
        </p>
      )}

      <Button
        onClick={handleGenerate}
        disabled={!canGenerate}
        aria-busy={busy}
        className="w-full sm:w-auto"
      >
        {busy ? "Generating…" : "Generate meal plan"}
      </Button>
    </div>
  );
}
