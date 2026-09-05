import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SegmentedTabs,
  INVENTORY_LOCATION_TABS,
  INVENTORY_LOCATION_ARIA_LABEL,
} from "@/components/layout/SegmentedTabs";

describe("SegmentedTabs", () => {
  it("renders four tabs with role=tab", () => {
    render(
      <SegmentedTabs
        value="all"
        onChange={() => {}}
        options={INVENTORY_LOCATION_TABS}
        ariaLabel={INVENTORY_LOCATION_ARIA_LABEL}
      />
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveTextContent("All");
    expect(tabs[1]).toHaveTextContent("Pantry");
    expect(tabs[2]).toHaveTextContent("Fridge");
    expect(tabs[3]).toHaveTextContent("Freezer");
  });

  it("marks the active tab with aria-selected", () => {
    render(
      <SegmentedTabs
        value="fridge"
        onChange={() => {}}
        options={INVENTORY_LOCATION_TABS}
        ariaLabel={INVENTORY_LOCATION_ARIA_LABEL}
      />
    );
    const fridge = screen.getByRole("tab", { name: /fridge/i });
    expect(fridge).toHaveAttribute("aria-selected", "true");
  });

  it("calls onChange when a tab is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedTabs
        value="all"
        onChange={onChange}
        options={INVENTORY_LOCATION_TABS}
        ariaLabel={INVENTORY_LOCATION_ARIA_LABEL}
      />
    );
    await user.click(screen.getByRole("tab", { name: /freezer/i }));
    expect(onChange).toHaveBeenCalledWith("freezer");
  });

  it("supports ArrowRight keyboard navigation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedTabs
        value="all"
        onChange={onChange}
        options={INVENTORY_LOCATION_TABS}
        ariaLabel={INVENTORY_LOCATION_ARIA_LABEL}
      />
    );
    const allTab = screen.getByRole("tab", { name: /all/i });
    allTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("pantry");
  });

  it("renders count badges when provided", () => {
    render(
      <SegmentedTabs
        value="all"
        onChange={() => {}}
        options={INVENTORY_LOCATION_TABS}
        ariaLabel={INVENTORY_LOCATION_ARIA_LABEL}
        counts={{ all: 12, pantry: 3, fridge: 7, freezer: 2 }}
      />
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders with arbitrary options and aria-label (generalized usage)", () => {
    render(
      <SegmentedTabs
        value="breakfast"
        onChange={() => {}}
        options={[
          { value: "breakfast", label: "Breakfast" },
          { value: "dinner", label: "Dinner" },
        ]}
        ariaLabel="Meal slot"
      />
    );
    expect(screen.getByRole("tablist", { name: "Meal slot" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
});
