import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecipeSheet } from "@/components/mealplan/RecipeSheet";
import type { MealPlanMealDetail } from "@/lib/api";

function makeMeal(overrides: Partial<MealPlanMealDetail> = {}): MealPlanMealDetail {
  return {
    id: "meal-1",
    householdId: "household-1",
    planId: "plan-1",
    dayId: "day-1",
    slot: "dinner",
    sortOrder: 0,
    title: "Onion Soup",
    summary: "A simple soup.",
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 30,
    instructions: ["Chop onions.", "Simmer 30 minutes."],
    detailStatus: "ready",
    detailError: null,
    ingredients: [
      {
        id: "ing-1",
        householdId: "household-1",
        mealId: "meal-1",
        rawText: "3 onions",
        nameNormalized: "onion",
        quantity: 3,
        unit: "unit",
        preparation: "chopped",
        optional: false,
        source: "pantry",
        sourceOverridden: false,
        matchedItemId: null,
        shoppingListItemId: null,
        matchConfidence: null,
        sortOrder: 0,
      },
      {
        id: "ing-2",
        householdId: "household-1",
        mealId: "meal-1",
        rawText: "2 cups broth",
        nameNormalized: "broth",
        quantity: 2,
        unit: "cup",
        preparation: null,
        optional: false,
        source: "purchase",
        sourceOverridden: false,
        matchedItemId: null,
        shoppingListItemId: null,
        matchConfidence: null,
        sortOrder: 1,
      },
    ],
    ...overrides,
  };
}

describe("RecipeSheet", () => {
  it("has both a SheetTitle and SheetDescription for axe's aria-dialog-name", () => {
    render(
      <RecipeSheet
        open
        onOpenChange={vi.fn()}
        meal={makeMeal()}
        dayLabel="Monday, Sep 8 · Dinner"
        onRetry={vi.fn()}
        isRetrying={false}
      />
    );
    expect(screen.getByRole("heading", { name: /onion soup/i, level: 2 })).toBeInTheDocument();
    // sr-only description still exists in the accessible tree.
    expect(document.querySelector(".sr-only")).toBeTruthy();
  });

  it("renders ingredients with have/buy chips (icon + text, not color alone)", () => {
    render(
      <RecipeSheet
        open
        onOpenChange={vi.fn()}
        meal={makeMeal()}
        dayLabel={null}
        onRetry={vi.fn()}
        isRetrying={false}
      />
    );
    expect(screen.getByText("3 onions")).toBeInTheDocument();
    expect(screen.getByText("Have it")).toBeInTheDocument();
    expect(screen.getByText("2 cups broth")).toBeInTheDocument();
    expect(screen.getByText("Buy")).toBeInTheDocument();
  });

  it("renders numbered steps restarting headings at h3 (SheetTitle is h2)", () => {
    render(
      <RecipeSheet
        open
        onOpenChange={vi.fn()}
        meal={makeMeal()}
        dayLabel={null}
        onRetry={vi.fn()}
        isRetrying={false}
      />
    );
    expect(screen.getByRole("heading", { level: 3, name: /ingredients/i })).toBeInTheDocument();
    const stepsHeading = screen.getByRole("heading", { level: 3, name: /steps/i });
    const stepsSection = stepsHeading.closest("div");
    expect(stepsSection).not.toBeNull();
    const list = within(stepsSection as HTMLElement).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows a distinct message and retry action when detail generation failed", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <RecipeSheet
        open
        onOpenChange={vi.fn()}
        meal={makeMeal({
          detailStatus: "failed",
          detailError: "Could not parse the model output.",
        })}
        dayLabel={null}
        onRetry={onRetry}
        isRetrying={false}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/could not parse the model output/i);
    await user.click(screen.getByRole("button", { name: /retry this recipe/i }));
    expect(onRetry).toHaveBeenCalledWith("meal-1");
  });

  it("shows a pending message while the recipe detail is still generating", () => {
    render(
      <RecipeSheet
        open
        onOpenChange={vi.fn()}
        meal={makeMeal({ detailStatus: "pending", instructions: [] })}
        dayLabel={null}
        onRetry={vi.fn()}
        isRetrying={false}
      />
    );
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();
  });

  it("still renders a title and description when no meal is found (e.g. stale deep link)", () => {
    render(
      <RecipeSheet
        open
        onOpenChange={vi.fn()}
        meal={null}
        dayLabel={null}
        onRetry={vi.fn()}
        isRetrying={false}
      />
    );
    expect(screen.getByRole("heading", { level: 2, name: /recipe/i })).toBeInTheDocument();
    expect(screen.getByText(/couldn't be found/i)).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when closed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <RecipeSheet
        open
        onOpenChange={onOpenChange}
        meal={makeMeal()}
        dayLabel={null}
        onRetry={vi.fn()}
        isRetrying={false}
      />
    );
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
