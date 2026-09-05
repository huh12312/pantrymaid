import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IngredientRow } from "@/components/mealplan/IngredientRow";
import type { MealPlanIngredientAggregate } from "@/lib/mealPlanIngredients";

function makeAggregate(
  overrides: Partial<MealPlanIngredientAggregate> = {}
): MealPlanIngredientAggregate {
  return {
    nameNormalized: "onion",
    displayName: "Onion",
    quantityLabel: "2 cups",
    status: "must_buy",
    expiryLabel: null,
    ingredientIds: ["ing-1"],
    usedOn: [{ dayIndex: 0, mealId: "meal-1", mealTitle: "Onion Soup" }],
    ...overrides,
  };
}

describe("IngredientRow", () => {
  it("renders a 'Have it' row with an icon AND a text label, no checkbox", () => {
    render(
      <IngredientRow
        aggregate={makeAggregate({ status: "have" })}
        startDate="2026-09-08"
        checked={false}
        onCheckedChange={vi.fn()}
        alreadyPending={false}
        onToggleSource={vi.fn()}
      />
    );
    expect(screen.getByText("Have it")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders a 'Have it — expiring' row with an amber warning badge and text, not colour alone", () => {
    render(
      <IngredientRow
        aggregate={makeAggregate({ status: "have_expiring", expiryLabel: "Expires today" })}
        startDate="2026-09-08"
        checked={false}
        onCheckedChange={vi.fn()}
        alreadyPending={false}
        onToggleSource={vi.fn()}
      />
    );
    expect(screen.getByText("Expires today")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders a 'Must buy' row with a pre-checked checkbox with a real accessible label", () => {
    render(
      <IngredientRow
        aggregate={makeAggregate({ status: "must_buy" })}
        startDate="2026-09-08"
        checked
        onCheckedChange={vi.fn()}
        alreadyPending={false}
        onToggleSource={vi.fn()}
      />
    );
    expect(screen.getByText("Must buy")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: /add onion to the re-order list/i });
    expect(checkbox).toBeChecked();
  });

  it("toggles via onCheckedChange when clicked", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <IngredientRow
        aggregate={makeAggregate({ status: "must_buy" })}
        startDate="2026-09-08"
        checked={false}
        onCheckedChange={onCheckedChange}
        alreadyPending={false}
        onToggleSource={vi.fn()}
      />
    );
    await user.click(screen.getByRole("checkbox"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("shows provenance chips built from usedOn (why this ingredient is listed)", () => {
    render(
      <IngredientRow
        aggregate={makeAggregate({
          usedOn: [
            { dayIndex: 0, mealId: "meal-1", mealTitle: "Onion Soup" },
            { dayIndex: 2, mealId: "meal-2", mealTitle: "Tacos" },
          ],
        })}
        startDate="2026-09-08"
        checked={false}
        onCheckedChange={vi.fn()}
        alreadyPending={false}
        onToggleSource={vi.fn()}
      />
    );
    expect(screen.getByText("Tue · Onion Soup, Thu · Tacos")).toBeInTheDocument();
  });

  it("flags an already-pending item so re-tapping never double-adds", () => {
    render(
      <IngredientRow
        aggregate={makeAggregate({ status: "must_buy" })}
        startDate="2026-09-08"
        checked={false}
        onCheckedChange={vi.fn()}
        alreadyPending
        onToggleSource={vi.fn()}
      />
    );
    expect(screen.getByText(/already on your re-order list/i)).toBeInTheDocument();
  });

  it("renders a real, labeled button (not an icon with no accessible name) to flip a must-buy row to already-have", async () => {
    const user = userEvent.setup();
    const onToggleSource = vi.fn();
    render(
      <IngredientRow
        aggregate={makeAggregate({ status: "must_buy" })}
        startDate="2026-09-08"
        checked
        onCheckedChange={vi.fn()}
        alreadyPending={false}
        onToggleSource={onToggleSource}
      />
    );
    const button = screen.getByRole("button", { name: /mark onion as already have it/i });
    await user.click(button);
    expect(onToggleSource).toHaveBeenCalledWith(["ing-1"], "pantry");
  });

  it("renders a real, labeled button to flip a have/have-expiring row to must-buy, for every underlying ingredient id", async () => {
    const user = userEvent.setup();
    const onToggleSource = vi.fn();
    render(
      <IngredientRow
        aggregate={makeAggregate({
          status: "have_expiring",
          expiryLabel: "Expires today",
          ingredientIds: ["ing-1", "ing-2"],
        })}
        startDate="2026-09-08"
        checked={false}
        onCheckedChange={vi.fn()}
        alreadyPending={false}
        onToggleSource={onToggleSource}
      />
    );
    const button = screen.getByRole("button", { name: /mark onion as needing purchase/i });
    await user.click(button);
    expect(onToggleSource).toHaveBeenCalledWith(["ing-1", "ing-2"], "purchase");
  });

  it("disables the toggle-source button while a flip is in flight", () => {
    render(
      <IngredientRow
        aggregate={makeAggregate({ status: "must_buy" })}
        startDate="2026-09-08"
        checked
        onCheckedChange={vi.fn()}
        alreadyPending={false}
        onToggleSource={vi.fn()}
        isTogglingSource
      />
    );
    expect(screen.getByRole("button", { name: /mark onion as already have it/i })).toBeDisabled();
  });
});
