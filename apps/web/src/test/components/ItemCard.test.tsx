import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemCard } from "@/components/inventory/ItemCard";
import type { InventoryItem } from "@/lib/api";

const baseItem: InventoryItem = {
  id: "1",
  name: "Milk",
  brand: "Organic Valley",
  quantity: 3,
  unit: "unit",
  location: "fridge",
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
};

/** Minimal set of required props for a collapsed, non-consuming card. */
function defaultProps(overrides: Partial<Parameters<typeof ItemCard>[0]> = {}) {
  return {
    item: baseItem,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onAdjustQuantity: vi.fn(),
    onQuickUpdate: vi.fn(),
    isExpanded: false,
    onToggleExpand: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Collapsed "Consume one" minus button
// ---------------------------------------------------------------------------

describe("ItemCard consume button", () => {
  it("shows consume button when quantity > 0", () => {
    render(<ItemCard {...defaultProps()} />);
    expect(screen.getByRole("button", { name: /consume one/i })).toBeInTheDocument();
  });

  it("hides consume button when quantity is 0", () => {
    render(<ItemCard {...defaultProps({ item: { ...baseItem, quantity: 0 } })} />);
    expect(screen.queryByRole("button", { name: /consume one/i })).not.toBeInTheDocument();
  });

  it("calls onAdjustQuantity(item, -1) when consume button is clicked", () => {
    const onAdjustQuantity = vi.fn();
    render(<ItemCard {...defaultProps({ onAdjustQuantity })} />);
    fireEvent.click(screen.getByRole("button", { name: /consume one/i }));
    expect(onAdjustQuantity).toHaveBeenCalledWith(baseItem, -1);
  });
});

// ---------------------------------------------------------------------------
// isConsuming prop
// ---------------------------------------------------------------------------

describe("ItemCard isConsuming prop", () => {
  it("disables consume button when isConsuming is true", () => {
    render(<ItemCard {...defaultProps({ isConsuming: true })} />);
    expect(screen.getByRole("button", { name: /consume one/i })).toBeDisabled();
  });

  it("enables consume button when isConsuming is false", () => {
    render(<ItemCard {...defaultProps({ isConsuming: false })} />);
    expect(screen.getByRole("button", { name: /consume one/i })).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Opened badge
// ---------------------------------------------------------------------------

describe("ItemCard opened badge", () => {
  it("shows opened badge when opened is true", () => {
    render(<ItemCard {...defaultProps({ item: { ...baseItem, opened: true } })} />);
    expect(screen.getByTitle(/opened/i)).toBeInTheDocument();
  });

  it("does not show opened badge when opened is false", () => {
    render(<ItemCard {...defaultProps()} />);
    expect(screen.queryByTitle(/opened/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Card body trigger (CollapsibleTrigger)
// ---------------------------------------------------------------------------

describe("ItemCard card body trigger", () => {
  it("clicking the card body calls onToggleExpand", async () => {
    const user = userEvent.setup();
    const onToggleExpand = vi.fn();
    render(<ItemCard {...defaultProps({ onToggleExpand })} />);
    // The trigger is the only button with aria-expanded in the collapsed state
    const trigger = screen.getByRole("button", { expanded: false });
    await user.click(trigger);
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("card body has aria-expanded=false when isExpanded is false", () => {
    render(<ItemCard {...defaultProps({ isExpanded: false })} />);
    const trigger = screen.getByRole("button", { expanded: false });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("card body has aria-expanded=true when isExpanded is true", () => {
    render(<ItemCard {...defaultProps({ isExpanded: true })} />);
    const trigger = screen.getByRole("button", { expanded: true });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});

// ---------------------------------------------------------------------------
// Expanded panel — stepper
// ---------------------------------------------------------------------------

describe("ItemCard expanded panel — stepper", () => {
  it("stepper buttons are visible when isExpanded is true", () => {
    render(<ItemCard {...defaultProps({ isExpanded: true })} />);
    expect(screen.getByRole("button", { name: /increase quantity/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /decrease quantity/i })).toBeInTheDocument();
  });

  it("clicking Increase quantity calls onAdjustQuantity(item, 1)", async () => {
    const user = userEvent.setup();
    const onAdjustQuantity = vi.fn();
    render(<ItemCard {...defaultProps({ isExpanded: true, onAdjustQuantity })} />);
    await user.click(screen.getByRole("button", { name: /increase quantity/i }));
    expect(onAdjustQuantity).toHaveBeenCalledWith(baseItem, 1);
  });

  it("clicking Decrease quantity calls onAdjustQuantity(item, -1)", async () => {
    const user = userEvent.setup();
    const onAdjustQuantity = vi.fn();
    render(<ItemCard {...defaultProps({ isExpanded: true, onAdjustQuantity })} />);
    await user.click(screen.getByRole("button", { name: /decrease quantity/i }));
    expect(onAdjustQuantity).toHaveBeenCalledWith(baseItem, -1);
  });

  it("Decrease quantity button is disabled when quantity is 0", () => {
    render(
      <ItemCard {...defaultProps({ isExpanded: true, item: { ...baseItem, quantity: 0 } })} />
    );
    expect(screen.getByRole("button", { name: /decrease quantity/i })).toBeDisabled();
  });

  it("Decrease quantity button is enabled when quantity > 0", () => {
    render(<ItemCard {...defaultProps({ isExpanded: true })} />);
    expect(screen.getByRole("button", { name: /decrease quantity/i })).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Expanded panel — Mark as opened checkbox
// ---------------------------------------------------------------------------

describe("ItemCard expanded panel — opened checkbox", () => {
  it("checking the checkbox calls onQuickUpdate(item.id, { opened: true })", async () => {
    const user = userEvent.setup();
    const onQuickUpdate = vi.fn();
    render(<ItemCard {...defaultProps({ isExpanded: true, onQuickUpdate })} />);
    const checkbox = screen.getByRole("checkbox", { name: /mark as opened/i });
    await user.click(checkbox);
    expect(onQuickUpdate).toHaveBeenCalledWith(baseItem.id, { opened: true });
  });

  it("unchecking the checkbox calls onQuickUpdate(item.id, { opened: false })", async () => {
    const user = userEvent.setup();
    const onQuickUpdate = vi.fn();
    render(
      <ItemCard
        {...defaultProps({ isExpanded: true, onQuickUpdate, item: { ...baseItem, opened: true } })}
      />
    );
    const checkbox = screen.getByRole("checkbox", { name: /mark as opened/i });
    await user.click(checkbox);
    expect(onQuickUpdate).toHaveBeenCalledWith(baseItem.id, { opened: false });
  });
});

// ---------------------------------------------------------------------------
// Action buttons — stopPropagation (onToggleExpand must NOT fire)
// ---------------------------------------------------------------------------

describe("ItemCard action buttons do not propagate to toggle", () => {
  it("clicking the edit button calls onEdit and does not call onToggleExpand", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onToggleExpand = vi.fn();
    render(<ItemCard {...defaultProps({ onEdit, onToggleExpand })} />);
    // The collapsed-row edit button has aria-label "Edit Milk"
    await user.click(screen.getByRole("button", { name: /edit milk/i }));
    expect(onEdit).toHaveBeenCalledWith(baseItem);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("clicking the delete button calls onDelete and does not call onToggleExpand", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onToggleExpand = vi.fn();
    render(<ItemCard {...defaultProps({ onDelete, onToggleExpand })} />);
    await user.click(screen.getByRole("button", { name: /delete milk/i }));
    expect(onDelete).toHaveBeenCalledWith(baseItem.id);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("clicking the consume-one button does not call onToggleExpand", async () => {
    const user = userEvent.setup();
    const onToggleExpand = vi.fn();
    render(<ItemCard {...defaultProps({ onToggleExpand })} />);
    await user.click(screen.getByRole("button", { name: /consume one/i }));
    expect(onToggleExpand).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Collapsed state — expanded panel controls are not in the document
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Expiration date rendering — guards the deleted `+ "T00:00:00"` workaround
// at the wiring level (ItemCard now goes through parseLocalDate).
// ---------------------------------------------------------------------------

describe("ItemCard expiration date rendering", () => {
  it("renders a bare YYYY-MM-DD expirationDate as the correct calendar day, not a day early", () => {
    // A regression here would look like `new Date(item.expirationDate)`
    // parsing "2026-04-15" as UTC midnight, which under a UTC-negative zone
    // (this suite pins TZ=America/New_York) displays April 14 instead of
    // April 15. `toLocaleDateString()`'s output format depends on the
    // runtime's default locale (not pinned by TZ alone), so derive the
    // expectation from the same call rather than hardcoding "4/15/2026".
    const expected = new Date(2026, 3, 15).toLocaleDateString();
    render(
      <ItemCard
        {...defaultProps({
          item: { ...baseItem, expirationDate: "2026-04-15" },
          isExpanded: false,
        })}
      />
    );
    // The collapsed row prefixes the date with "Expired "/"Expires " when
    // relevant; match the date as a substring so that prefix doesn't matter.
    expect(screen.getByText(new RegExp(expected.replace(/\//g, "\\/")))).toBeInTheDocument();
  });
});

describe("ItemCard collapsed state — expanded panel is hidden", () => {
  it("stepper buttons are not in the document when isExpanded is false", () => {
    render(<ItemCard {...defaultProps({ isExpanded: false })} />);
    expect(screen.queryByRole("button", { name: /increase quantity/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /decrease quantity/i })).not.toBeInTheDocument();
  });

  it("Mark as opened checkbox is not in the document when isExpanded is false", () => {
    render(<ItemCard {...defaultProps({ isExpanded: false })} />);
    expect(screen.queryByRole("checkbox", { name: /mark as opened/i })).not.toBeInTheDocument();
  });
});
