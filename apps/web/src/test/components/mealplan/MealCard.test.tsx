import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MealCard } from "@/components/mealplan/MealCard";
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
    ingredients: [],
    ...overrides,
  };
}

function renderCard(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("MealCard", () => {
  it("placeholder variant renders an inert skeleton, not a link or button", () => {
    renderCard(<MealCard variant="placeholder" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ready meal renders as a real link to the recipe route with the requested heading level", () => {
    renderCard(
      <MealCard
        variant="meal"
        meal={makeMeal()}
        titleAs="h3"
        onRetry={vi.fn()}
        isRetrying={false}
      />
    );
    const link = screen.getByRole("link", { name: /onion soup/i });
    expect(link).toHaveAttribute("href", "/meal-plan/recipe/meal-1");
    expect(screen.getByRole("heading", { level: 3, name: /onion soup/i })).toBeInTheDocument();
    expect(screen.getByText(/40 min/i)).toBeInTheDocument();
    expect(screen.getByText(/serves 4/i)).toBeInTheDocument();
  });

  it("uses h4 when grouped under a slot label (multi-slot day)", () => {
    renderCard(
      <MealCard
        variant="meal"
        meal={makeMeal()}
        titleAs="h4"
        onRetry={vi.fn()}
        isRetrying={false}
      />
    );
    expect(screen.getByRole("heading", { level: 4, name: /onion soup/i })).toBeInTheDocument();
  });

  it("pending meal is still a real link, showing a preparing indicator instead of meta", () => {
    renderCard(
      <MealCard
        variant="meal"
        meal={makeMeal({ detailStatus: "pending" })}
        titleAs="h3"
        onRetry={vi.fn()}
        isRetrying={false}
      />
    );
    expect(screen.getByRole("link", { name: /onion soup/i })).toBeInTheDocument();
    expect(screen.getByText(/preparing recipe/i)).toBeInTheDocument();
  });

  it("failed meal shows an inline retry button rather than a navigable link", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderCard(
      <MealCard
        variant="meal"
        meal={makeMeal({ detailStatus: "failed", detailError: "Model output was invalid." })}
        titleAs="h3"
        onRetry={onRetry}
        isRetrying={false}
      />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/model output was invalid/i);
    await user.click(screen.getByRole("button", { name: /retry this recipe/i }));
    expect(onRetry).toHaveBeenCalledWith("meal-1");
  });

  it("disables the retry button and shows a retrying label while isRetrying is true", () => {
    renderCard(
      <MealCard
        variant="meal"
        meal={makeMeal({ detailStatus: "failed" })}
        titleAs="h3"
        onRetry={vi.fn()}
        isRetrying
      />
    );
    expect(screen.getByRole("button", { name: /retrying/i })).toBeDisabled();
  });
});
