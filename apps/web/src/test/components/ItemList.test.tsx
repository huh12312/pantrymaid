import { describe, test, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemList } from "@/components/inventory/ItemList";
import type { InventoryItem } from "@/lib/api";

function makeItem(
  overrides: Partial<InventoryItem> & Pick<InventoryItem, "id" | "name">
): InventoryItem {
  return {
    brand: null,
    quantity: 3,
    unit: "unit",
    location: "pantry",
    category: "Dairy",
    expirationDate: null,
    expirationEstimated: false,
    barcodeUpc: null,
    imageUrl: null,
    notes: null,
    opened: false,
    householdId: "hh1",
    addedBy: "u1",
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function listProps(items: InventoryItem[], overrides = {}) {
  return {
    items,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onAdjustQuantity: vi.fn(),
    onQuickUpdate: vi.fn(),
    ...overrides,
  };
}

/** The expand trigger is the only button carrying aria-expanded. */
function trigger(name: RegExp) {
  return screen.getByRole("button", { name, expanded: false });
}

/**
 * Integration: exercises the real click -> onToggleExpand -> setExpandedId ->
 * re-render -> CollapsibleContent mounts loop that the controlled ItemCard unit
 * tests cannot cover (they pass isExpanded directly).
 */
describe("ItemList expand/collapse (integration)", () => {
  const milk = makeItem({ id: "1", name: "Milk" });
  const eggs = makeItem({ id: "2", name: "Eggs" });

  it("expands a card's panel when its body is clicked", async () => {
    const user = userEvent.setup();
    render(<ItemList {...listProps([milk, eggs])} />);

    // Panels start closed: no stepper controls mounted.
    expect(screen.queryByRole("button", { name: /increase quantity/i })).not.toBeInTheDocument();

    await user.click(trigger(/Milk/i));

    // The expanded panel (stepper + opened toggle) is now in the document.
    expect(screen.getByRole("button", { name: /increase quantity/i })).toBeInTheDocument();
    expect(screen.getByText(/mark as opened/i)).toBeInTheDocument();
  });

  it("routes stepper clicks in the opened panel to onAdjustQuantity", async () => {
    const user = userEvent.setup();
    const onAdjustQuantity = vi.fn();
    render(<ItemList {...listProps([milk, eggs], { onAdjustQuantity })} />);

    await user.click(trigger(/Milk/i));
    await user.click(screen.getByRole("button", { name: /increase quantity/i }));

    expect(onAdjustQuantity).toHaveBeenCalledWith(milk, 1);
  });

  it("keeps only one card open at a time (accordion)", async () => {
    const user = userEvent.setup();
    render(<ItemList {...listProps([milk, eggs])} />);

    await user.click(trigger(/Milk/i));
    expect(screen.getAllByRole("button", { name: /increase quantity/i })).toHaveLength(1);

    // Opening Eggs closes Milk — still exactly one panel mounted.
    await user.click(trigger(/Eggs/i));
    expect(screen.getAllByRole("button", { name: /increase quantity/i })).toHaveLength(1);

    // Clicking the open card again collapses it — zero panels mounted.
    await user.click(screen.getByRole("button", { name: /Eggs/i, expanded: true }));
    expect(screen.queryByRole("button", { name: /increase quantity/i })).not.toBeInTheDocument();
  });
});

/**
 * Skeleton tests retained for future implementation (TDD placeholders).
 */
describe("ItemList Component", () => {
  describe("Rendering", () => {
    test.todo("should render empty state when no items");
    test.todo("should render list of items");
    test.todo("should display item details (name, brand, location, quantity)");
    test.todo("should show expiration dates");
    test.todo("should indicate expiration estimated vs actual");
  });

  describe("Filtering", () => {
    test.todo("should filter items by location (pantry/fridge/freezer)");
    test.todo("should filter items by category");
    test.todo("should filter items by expiration soon");
    test.todo("should clear filters");
  });

  describe("Sorting", () => {
    test.todo("should sort items by name");
    test.todo("should sort items by expiration date");
    test.todo("should sort items by date added");
  });

  describe("Search", () => {
    test.todo("should search items by name");
    test.todo("should search items by brand");
    test.todo("should show no results message when search yields nothing");
  });

  describe("Item Actions", () => {
    test.todo("should navigate to item detail on click");
    test.todo("should show delete confirmation");
    test.todo("should delete item");
    test.todo("should show edit button");
  });

  describe("Loading States", () => {
    test.todo("should show loading spinner while fetching");
    test.todo("should show error message on fetch failure");
    test.todo("should retry on error");
  });

  describe("Pagination", () => {
    test.todo("should paginate long lists");
    test.todo("should navigate to next page");
    test.todo("should navigate to previous page");
  });
});
