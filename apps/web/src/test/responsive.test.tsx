import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setViewportWidth } from "./utils/matchMedia";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import { MobileFAB } from "@/components/layout/MobileFAB";
import {
  SegmentedTabs,
  INVENTORY_LOCATION_TABS,
  INVENTORY_LOCATION_ARIA_LABEL,
} from "@/components/layout/SegmentedTabs";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ThemeProvider } from "@/components/layout/ThemeProvider";

const noop = () => {};

const renderWithTheme = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <ThemeProvider>{ui}</ThemeProvider>
    </MemoryRouter>
  );

describe("responsive chrome at mobile viewport (360px)", () => {
  it("MobileTopBar root carries md:hidden class", () => {
    setViewportWidth(360);
    renderWithTheme(
      <MobileTopBar
        onAdd={noop}
        onScan={noop}
        onReceipt={noop}
        onLogout={noop}
        onSearchToggle={noop}
      />
    );
    const header = screen.getByTestId("mobile-top-bar");
    expect(header.className).toMatch(/md:hidden/);
  });

  it("MobileFAB root carries md:hidden class", () => {
    setViewportWidth(360);
    render(<MobileFAB onClick={noop} />);
    const fab = screen.getByRole("button", { name: /add item/i });
    expect(fab.className).toMatch(/md:hidden/);
  });

  it("SegmentedTabs initial focus is the active tab", () => {
    setViewportWidth(360);
    render(
      <SegmentedTabs
        value="pantry"
        onChange={noop}
        options={INVENTORY_LOCATION_TABS}
        ariaLabel={INVENTORY_LOCATION_ARIA_LABEL}
      />
    );
    const pantry = screen.getByRole("tab", { name: /pantry/i });
    expect(pantry).toHaveAttribute("tabindex", "0");
    const all = screen.getByRole("tab", { name: /all/i });
    expect(all).toHaveAttribute("tabindex", "-1");
  });
});

describe("responsive at desktop viewport (1280px)", () => {
  it("MobileTopBar still emits md:hidden so it is hidden by Tailwind at desktop", () => {
    setViewportWidth(1280);
    renderWithTheme(<MobileTopBar onAdd={noop} onScan={noop} onReceipt={noop} onLogout={noop} />);
    expect(screen.getByTestId("mobile-top-bar").className).toMatch(/md:hidden/);
  });

  it("matchMedia reports md+ true above breakpoint", () => {
    setViewportWidth(1280);
    expect(window.matchMedia("(min-width: 768px)").matches).toBe(true);
  });

  it("matchMedia reports md+ false below breakpoint", () => {
    setViewportWidth(360);
    expect(window.matchMedia("(min-width: 768px)").matches).toBe(false);
  });
});

describe("Sheet variant selection by side prop", () => {
  it("renders bottom sheet at mobile width", () => {
    setViewportWidth(360);
    render(
      <Sheet open>
        <SheetContent side="bottom">
          <SheetTitle>BottomSheet</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    const content = screen.getByTestId("sheet-content");
    expect(content.className).toMatch(/bottom-0/);
  });

  it("renders centered dialog when side=dialog", () => {
    setViewportWidth(1280);
    render(
      <Sheet open>
        <SheetContent side="dialog">
          <SheetTitle>Centered</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByTestId("sheet-content").className).toMatch(/translate-x-\[-50%\]/);
  });
});

describe("SegmentedTabs keyboard nav", () => {
  it("ArrowLeft from first tab wraps to last", async () => {
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
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenCalledWith("freezer");
  });
});
