import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../mocks/server";
import { PlanShoppingSheet } from "@/components/mealplan/PlanShoppingSheet";
import type { MealPlanIngredientAggregate } from "@/lib/mealPlanIngredients";

const API_BASE = "http://localhost:3000";

function makeAggregate(
  overrides: Partial<MealPlanIngredientAggregate> = {}
): MealPlanIngredientAggregate {
  return {
    nameNormalized: "onion",
    displayName: "Onion",
    quantityLabel: "2 units",
    status: "must_buy",
    expiryLabel: null,
    ingredientIds: ["ing-1"],
    usedOn: [{ dayIndex: 0, mealId: "meal-1", mealTitle: "Onion Soup" }],
    ...overrides,
  };
}

function mockShoppingList(names: string[]) {
  server.use(
    http.get(`${API_BASE}/api/shopping-list`, () => {
      return HttpResponse.json({
        success: true,
        data: names.map((name, i) => ({
          id: `sl-${i}`,
          householdId: "household-1",
          name,
          brand: null,
          category: null,
          unit: null,
          suggestedQty: 1,
          sourceItemId: null,
          status: "pending",
          addedBy: "user-1",
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      });
    })
  );
}

function renderSheet(props: Partial<React.ComponentProps<typeof PlanShoppingSheet>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const defaults: React.ComponentProps<typeof PlanShoppingSheet> = {
    open: true,
    onOpenChange: vi.fn(),
    aggregates: [],
    startDate: "2026-09-08",
    onCommit: vi.fn(),
    isCommitting: false,
    statusMessage: null,
    onToggleIngredientSource: vi.fn(),
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanShoppingSheet {...defaults} {...props} />
    </QueryClientProvider>
  );
}

describe("PlanShoppingSheet", () => {
  it("has both a SheetTitle and SheetDescription for axe's aria-dialog-name", async () => {
    mockShoppingList([]);
    renderSheet({ aggregates: [makeAggregate()] });
    expect(await screen.findByRole("heading", { name: /buy list/i, level: 2 })).toBeInTheDocument();
    expect(document.querySelector(".sr-only")).toBeTruthy();
  });

  it("groups aggregates Must buy -> Expiring -> Have it under h3 headings", async () => {
    mockShoppingList([]);
    renderSheet({
      aggregates: [
        makeAggregate({
          nameNormalized: "milk",
          displayName: "Milk",
          status: "have_expiring",
          expiryLabel: "Expires today",
        }),
        makeAggregate({ nameNormalized: "flour", displayName: "Flour", status: "must_buy" }),
        makeAggregate({ nameNormalized: "eggs", displayName: "Eggs", status: "have" }),
      ],
    });
    await screen.findByText("Flour");
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(["Must buy", "Expiring", "Have it"]);
  });

  it("pre-checks must-buy items and reflects the count on the primary button", async () => {
    mockShoppingList([]);
    renderSheet({
      aggregates: [
        makeAggregate({ nameNormalized: "onion", displayName: "Onion", status: "must_buy" }),
        makeAggregate({ nameNormalized: "garlic", displayName: "Garlic", status: "must_buy" }),
      ],
    });
    expect(
      await screen.findByRole("button", { name: /add 2 to re-order list/i })
    ).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    for (const cb of checkboxes) expect(cb).toBeChecked();
  });

  it("calls onCommit once with the ingredientIds of only the checked aggregates", async () => {
    mockShoppingList([]);
    const onCommit = vi.fn();
    const user = userEvent.setup();
    renderSheet({
      aggregates: [
        makeAggregate({
          nameNormalized: "onion",
          displayName: "Onion",
          ingredientIds: ["ing-onion-1", "ing-onion-2"],
          status: "must_buy",
        }),
        makeAggregate({
          nameNormalized: "garlic",
          displayName: "Garlic",
          ingredientIds: ["ing-garlic-1"],
          status: "must_buy",
        }),
      ],
      onCommit,
    });

    // Uncheck garlic, leaving only onion selected.
    const garlicCheckbox = await screen.findByRole("checkbox", { name: /add garlic/i });
    await user.click(garlicCheckbox);

    await user.click(screen.getByRole("button", { name: /add 1 to re-order list/i }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(["ing-onion-1", "ing-onion-2"], 1);
  });

  it("dedupes against an already-pending shopping list item: it is not pre-checked and is excluded from the default count", async () => {
    mockShoppingList(["Onion"]); // already pending under this normalized name
    renderSheet({
      aggregates: [
        makeAggregate({ nameNormalized: "onion", displayName: "Onion", status: "must_buy" }),
        makeAggregate({ nameNormalized: "garlic", displayName: "Garlic", status: "must_buy" }),
      ],
    });

    expect(
      await screen.findByRole("button", { name: /add 1 to re-order list/i })
    ).toBeInTheDocument();
    expect(await screen.findByText(/already on your re-order list/i)).toBeInTheDocument();
    const onionCheckbox = screen.getByRole("checkbox", { name: /add onion/i });
    expect(onionCheckbox).not.toBeChecked();
    const garlicCheckbox = screen.getByRole("checkbox", { name: /add garlic/i });
    expect(garlicCheckbox).toBeChecked();
  });

  it("dedupes a mass-noun / irregular-plural aggregate against a manually-added shopping item with the same underlying word", async () => {
    // The aggregate's nameNormalized is server-derived ("tomato", from the server's
    // curated normalizer). The shopping-list item was typed by hand ("Tomatoes") and
    // never passed through the server's meal-plan normalizer — it only goes through
    // this component's own client-side `normalizeIngredientName`. Both sides must land
    // on the same key ("tomato") or the "already pending" badge silently fails to
    // appear (the bug: the client's old normalizer produced "tomatoe" for this input).
    mockShoppingList(["Tomatoes"]);
    renderSheet({
      aggregates: [
        makeAggregate({ nameNormalized: "tomato", displayName: "Tomato", status: "must_buy" }),
      ],
    });

    expect(await screen.findByText(/already on your re-order list/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /add tomato/i })).not.toBeChecked();
  });

  it("announces the commit result via a single role=status region", async () => {
    mockShoppingList([]);
    renderSheet({ statusMessage: "Added 2 items to your re-order list." });
    expect(await screen.findByRole("status")).toHaveTextContent(/added 2 items/i);
  });

  it("disables the primary button while committing and while nothing is checked", async () => {
    mockShoppingList([]);
    const { rerender } = renderSheet({ aggregates: [], isCommitting: false });
    expect(await screen.findByRole("button", { name: /add 0 to re-order list/i })).toBeDisabled();

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <PlanShoppingSheet
          open
          onOpenChange={vi.fn()}
          aggregates={[makeAggregate({ status: "must_buy" })]}
          startDate="2026-09-08"
          onCommit={vi.fn()}
          isCommitting
          statusMessage={null}
          onToggleIngredientSource={vi.fn()}
        />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /adding/i })).toBeDisabled());
  });
});
