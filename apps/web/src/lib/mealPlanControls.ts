import { create } from "zustand";
import { persist } from "zustand/middleware";
import { parseLocalDate, monthAbbreviation } from "@/lib/dates";
import type { MealPlanMode, MealSlot } from "@/lib/api";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** "Monday, Sep 8" from a local "YYYY-MM-DD" date string. Falls back to the raw
 * string if it can't be parsed rather than throwing — display code should degrade,
 * not crash, on an unexpected value. */
export function formatMealPlanDayHeading(date: string): string {
  const parsed = parseLocalDate(date);
  if (!parsed) return date;
  return `${WEEKDAYS[parsed.getDay()]}, ${monthAbbreviation(parsed.getMonth())} ${parsed.getDate()}`;
}

/**
 * Per-generation request parameters (plan §5.7, §11.1). These are NOT settings —
 * they're request inputs the user picks each time they generate a plan — but their
 * *last* value persists across sessions (mirroring `lib/houseStore.ts`) so the
 * generate controls don't reset to defaults every visit, and so the plan header can
 * render them as "how this plan was produced" chips.
 */
export const SLOT_ORDER: readonly MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

/** Sorts meals into the canonical slot order regardless of the order the API returns. */
export function sortMealsBySlot<T extends { slot: MealSlot }>(meals: readonly T[]): T[] {
  return [...meals].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
}

/**
 * Distinct slots actually used across a plan's days, canonically ordered. Used to
 * render "how this plan was produced" chips — the plan row itself doesn't persist
 * the requested `slots[]` (only `mode`/`includeExpired` do), so the generated meals
 * are the source of truth for which slots were used.
 */
export function usedSlots(days: readonly { meals: readonly { slot: MealSlot }[] }[]): MealSlot[] {
  const seen = new Set<MealSlot>();
  for (const day of days) {
    for (const meal of day.meals) seen.add(meal.slot);
  }
  return SLOT_ORDER.filter((slot) => seen.has(slot));
}

/**
 * Rough, honest-effort estimate for the generate-controls live estimate copy (plan
 * §5.7: "28 meals, roughly 2 minutes"). Phase 2 is one LLM call per meal at
 * concurrency 4 (plan §2.2, §11.1); ~15s/call average plus a ~5s phase-1 skeleton
 * call is a reasonable rough model — this is display copy, not a billing estimate.
 */
export function estimateMealPlanGeneration(
  dayCount: number,
  slotCount: number
): { meals: number; minutes: number } {
  const meals = Math.max(0, dayCount) * Math.max(0, slotCount);
  if (meals === 0) return { meals: 0, minutes: 0 };
  const seconds = Math.ceil(meals / 4) * 15 + 5;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return { meals, minutes };
}

interface MealPlanControlsStore {
  slots: MealSlot[];
  mode: MealPlanMode;
  includeExpired: boolean;
  toggleSlot: (slot: MealSlot) => void;
  setMode: (mode: MealPlanMode) => void;
  setIncludeExpired: (value: boolean) => void;
}

export const useMealPlanControlsStore = create<MealPlanControlsStore>()(
  persist(
    (set) => ({
      slots: ["dinner"],
      mode: "balanced",
      includeExpired: false,
      toggleSlot: (slot) =>
        set((state) => {
          const has = state.slots.includes(slot);
          const next = has ? state.slots.filter((s) => s !== slot) : [...state.slots, slot];
          // At least one slot is always required (plan §5.7) — refuse to empty it out.
          if (next.length === 0) return state;
          return { slots: sortMealsBySlot(next.map((s) => ({ slot: s }))).map((s) => s.slot) };
        }),
      setMode: (mode) => set({ mode }),
      setIncludeExpired: (includeExpired) => set({ includeExpired }),
    }),
    { name: "pantryradar-meal-plan-controls" }
  )
);
