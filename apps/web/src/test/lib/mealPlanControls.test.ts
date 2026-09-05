import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateMealPlanGeneration,
  sortMealsBySlot,
  usedSlots,
  formatMealPlanDayHeading,
  useMealPlanControlsStore,
} from "@/lib/mealPlanControls";

describe("estimateMealPlanGeneration", () => {
  it("returns zero meals/minutes when either input is zero", () => {
    expect(estimateMealPlanGeneration(0, 4)).toEqual({ meals: 0, minutes: 0 });
    expect(estimateMealPlanGeneration(7, 0)).toEqual({ meals: 0, minutes: 0 });
  });

  it("scales meals as dayCount * slotCount", () => {
    expect(estimateMealPlanGeneration(7, 4).meals).toBe(28);
    expect(estimateMealPlanGeneration(14, 4).meals).toBe(56);
    expect(estimateMealPlanGeneration(7, 1).meals).toBe(7);
  });

  it("never estimates less than one minute", () => {
    expect(estimateMealPlanGeneration(1, 1).minutes).toBeGreaterThanOrEqual(1);
  });

  it("estimates more time for more meals", () => {
    const small = estimateMealPlanGeneration(7, 1);
    const large = estimateMealPlanGeneration(14, 4);
    expect(large.minutes).toBeGreaterThan(small.minutes);
  });
});

describe("sortMealsBySlot", () => {
  it("orders meals canonically breakfast -> lunch -> dinner -> snack regardless of input order", () => {
    const input = [
      { slot: "snack" as const },
      { slot: "breakfast" as const },
      { slot: "dinner" as const },
    ];
    expect(sortMealsBySlot(input).map((m) => m.slot)).toEqual(["breakfast", "dinner", "snack"]);
  });

  it("does not mutate the input array", () => {
    const input = [{ slot: "dinner" as const }, { slot: "breakfast" as const }];
    const copy = [...input];
    sortMealsBySlot(input);
    expect(input).toEqual(copy);
  });
});

describe("usedSlots", () => {
  it("returns the distinct slots present across all days, canonically ordered", () => {
    const days = [
      { meals: [{ slot: "dinner" as const }] },
      { meals: [{ slot: "breakfast" as const }, { slot: "dinner" as const }] },
    ];
    expect(usedSlots(days)).toEqual(["breakfast", "dinner"]);
  });

  it("returns an empty array for a plan with no meals yet", () => {
    expect(usedSlots([{ meals: [] }])).toEqual([]);
  });
});

describe("formatMealPlanDayHeading", () => {
  it("formats a local date string as 'Weekday, Mon D'", () => {
    // 2026-09-08 is a Tuesday.
    expect(formatMealPlanDayHeading("2026-09-08")).toBe("Tuesday, Sep 8");
  });

  it("falls back to the raw string for an unparseable date rather than throwing", () => {
    expect(formatMealPlanDayHeading("not-a-date")).toBe("not-a-date");
  });
});

describe("useMealPlanControlsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useMealPlanControlsStore.setState({
      slots: ["dinner"],
      mode: "balanced",
      includeExpired: false,
    });
  });

  it("defaults to dinner only, balanced mode, and includeExpired off", () => {
    const state = useMealPlanControlsStore.getState();
    expect(state.slots).toEqual(["dinner"]);
    expect(state.mode).toBe("balanced");
    expect(state.includeExpired).toBe(false);
  });

  it("toggleSlot adds and removes slots, keeping canonical order", () => {
    useMealPlanControlsStore.getState().toggleSlot("breakfast");
    expect(useMealPlanControlsStore.getState().slots).toEqual(["breakfast", "dinner"]);
    useMealPlanControlsStore.getState().toggleSlot("dinner");
    expect(useMealPlanControlsStore.getState().slots).toEqual(["breakfast"]);
  });

  it("refuses to remove the last remaining slot", () => {
    useMealPlanControlsStore.getState().toggleSlot("dinner");
    expect(useMealPlanControlsStore.getState().slots).toEqual(["dinner"]);
  });

  it("setMode and setIncludeExpired update independently", () => {
    useMealPlanControlsStore.getState().setMode("expiring_first");
    useMealPlanControlsStore.getState().setIncludeExpired(true);
    const state = useMealPlanControlsStore.getState();
    expect(state.mode).toBe("expiring_first");
    expect(state.includeExpired).toBe(true);
  });
});
