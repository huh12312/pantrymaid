import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DaySection } from "@/components/mealplan/DaySection";
import type { MealPlanMealDetail } from "@/lib/api";

function makeMeal(overrides: Partial<MealPlanMealDetail>): MealPlanMealDetail {
  return {
    id: `meal-${overrides.slot ?? "x"}`,
    householdId: "household-1",
    planId: "plan-1",
    dayId: "day-1",
    slot: "dinner",
    sortOrder: 0,
    title: `${overrides.slot ?? "Meal"} title`,
    summary: null,
    servings: 2,
    prepMinutes: 5,
    cookMinutes: 10,
    instructions: [],
    detailStatus: "ready",
    detailError: null,
    ingredients: [],
    ...overrides,
  };
}

function renderDay(props: Partial<React.ComponentProps<typeof DaySection>> = {}) {
  const defaults: React.ComponentProps<typeof DaySection> = {
    dayIndex: 0,
    date: "2026-09-08",
    meals: null,
    placeholderCount: 1,
    isToday: false,
    onRetryMeal: vi.fn(),
    retryingMealId: null,
    sectionRef: () => {},
    headingRef: () => {},
  };
  return render(
    <MemoryRouter>
      <DaySection {...defaults} {...props} />
    </MemoryRouter>
  );
}

describe("DaySection", () => {
  it("renders the day heading as an h2 with the weekday and date", () => {
    renderDay();
    expect(screen.getByRole("heading", { level: 2, name: /tuesday, sep 8/i })).toBeInTheDocument();
  });

  it("shows a Today badge only when isToday is true", () => {
    const { rerender } = renderDay({ isToday: false });
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <DaySection
          dayIndex={0}
          date="2026-09-08"
          meals={null}
          placeholderCount={1}
          isToday
          onRetryMeal={vi.fn()}
          retryingMealId={null}
          sectionRef={() => {}}
          headingRef={() => {}}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("renders skeleton placeholders while meals is null (skeleton phase)", () => {
    const { container } = renderDay({ meals: null, placeholderCount: 2 });
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(2);
  });

  it("a single-meal day renders the meal title as an h3, with no slot label", () => {
    renderDay({ meals: [makeMeal({ slot: "dinner" })] });
    expect(screen.getByRole("heading", { level: 3, name: /dinner title/i })).toBeInTheDocument();
    expect(screen.queryByText("Dinner")).not.toBeInTheDocument();
  });

  it("a multi-slot day orders meals canonically and drops meal titles to h4 under h3 slot labels", () => {
    renderDay({
      meals: [
        makeMeal({ slot: "snack", sortOrder: 3 }),
        makeMeal({ slot: "breakfast", sortOrder: 0 }),
        makeMeal({ slot: "dinner", sortOrder: 2 }),
      ],
    });

    const slotHeadings = screen.getAllByRole("heading", { level: 3 });
    expect(slotHeadings.map((h) => h.textContent)).toEqual(["Breakfast", "Dinner", "Snack"]);

    const mealHeadings = screen.getAllByRole("heading", { level: 4 });
    expect(mealHeadings.map((h) => h.textContent)).toEqual([
      "breakfast title",
      "dinner title",
      "snack title",
    ]);

    // Each slot label is immediately followed by its own meal card, not just in the
    // right order globally.
    const breakfastGroup = slotHeadings[0]?.closest("div");
    expect(
      breakfastGroup ? within(breakfastGroup).getByText("breakfast title") : null
    ).toBeTruthy();
  });

  it("shows the per-day to-buy count next to the Today badge when greater than zero", () => {
    renderDay({ toBuyCount: 3 });
    expect(screen.getByText("3 to buy")).toBeInTheDocument();
  });

  it("renders no to-buy indicator when the count is zero or omitted", () => {
    const { rerender } = renderDay({ toBuyCount: 0 });
    expect(screen.queryByText(/to buy/i)).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <DaySection
          dayIndex={0}
          date="2026-09-08"
          meals={null}
          placeholderCount={1}
          isToday={false}
          onRetryMeal={vi.fn()}
          retryingMealId={null}
          sectionRef={() => {}}
          headingRef={() => {}}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText(/to buy/i)).not.toBeInTheDocument();
  });
});
