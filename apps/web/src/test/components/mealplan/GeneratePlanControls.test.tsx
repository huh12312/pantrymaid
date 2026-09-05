import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GeneratePlanControls } from "@/components/mealplan/GeneratePlanControls";
import type { GeneratePlanControlsProps } from "@/components/mealplan/GeneratePlanControls";

function baseProps(overrides: Partial<GeneratePlanControlsProps> = {}): GeneratePlanControlsProps {
  return {
    slots: ["dinner"],
    onToggleSlot: vi.fn(),
    prioritizeExpiring: false,
    onPrioritizeExpiringChange: vi.fn(),
    includeExpired: false,
    onIncludeExpiredChange: vi.fn(),
    totalItems: 42,
    expiringCount: 6,
    expiredCount: 0,
    isGenerating: false,
    isStarting: false,
    onGenerate: vi.fn(),
    startDate: "2026-09-08",
    ...overrides,
  };
}

describe("GeneratePlanControls", () => {
  it("shows a live meal/time estimate based on the selected slots", () => {
    render(
      <GeneratePlanControls {...baseProps({ slots: ["breakfast", "lunch", "dinner", "snack"] })} />
    );
    expect(screen.getByText(/28 meals, roughly/i)).toBeInTheDocument();
  });

  it("shows a concrete preview line naming pantry item and expiring counts", () => {
    render(<GeneratePlanControls {...baseProps()} />);
    expect(screen.getByText(/we'll use 42 pantry items, 6 expiring soon/i)).toBeInTheDocument();
  });

  it("warns instead of the preview line when the pantry is empty", () => {
    render(<GeneratePlanControls {...baseProps({ totalItems: 0, expiringCount: 0 })} />);
    expect(screen.getByText(/pantry is empty/i)).toBeInTheDocument();
    expect(screen.queryByText(/we'll use/i)).not.toBeInTheDocument();
  });

  it("hides the include-expired switch entirely when there are no expired items", () => {
    render(<GeneratePlanControls {...baseProps({ expiredCount: 0 })} />);
    expect(screen.queryByText(/include expired items/i)).not.toBeInTheDocument();
  });

  it("shows the include-expired switch, defaulting off, when there are expired items", () => {
    render(<GeneratePlanControls {...baseProps({ expiredCount: 3, includeExpired: false })} />);
    const toggle = screen.getByRole("switch", { name: /include expired items/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/3 expired items/i)).toBeInTheDocument();
  });

  it("disables Generate and shows a validation message when no slot is selected", () => {
    render(<GeneratePlanControls {...baseProps({ slots: [] })} />);
    expect(screen.getByText(/select at least one meal/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate meal plan/i })).toBeDisabled();
  });

  it("calls onGenerate with the composed request when clicked", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(
      <GeneratePlanControls
        {...baseProps({
          slots: ["dinner"],
          prioritizeExpiring: true,
          includeExpired: false,
          onGenerate,
        })}
      />
    );
    await user.click(screen.getByRole("button", { name: /generate meal plan/i }));
    expect(onGenerate).toHaveBeenCalledWith({
      startDate: "2026-09-08",
      dayCount: 7,
      slots: ["dinner"],
      mode: "expiring_first",
      includeExpired: false,
    });
  });

  it("shows aria-busy and a disabled Generating state while starting, so a second click can't fire", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<GeneratePlanControls {...baseProps({ isStarting: true, onGenerate })} />);
    const button = screen.getByRole("button", { name: /generating/i });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("toggling a slot checkbox invokes onToggleSlot with that slot", async () => {
    const user = userEvent.setup();
    const onToggleSlot = vi.fn();
    render(<GeneratePlanControls {...baseProps({ onToggleSlot })} />);
    await user.click(screen.getByRole("checkbox", { name: /breakfast/i }));
    expect(onToggleSlot).toHaveBeenCalledWith("breakfast");
  });
});
