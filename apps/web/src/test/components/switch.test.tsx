import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

describe("Switch", () => {
  it("renders as a switch role, unchecked by default", () => {
    render(<Switch aria-label="Prioritize expiring food" />);
    const el = screen.getByRole("switch", { name: "Prioritize expiring food" });
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-checked", "false");
  });

  it("forwards className onto the root", () => {
    render(<Switch aria-label="toggle" className="my-custom-class" />);
    expect(screen.getByRole("switch")).toHaveClass("my-custom-class");
  });

  it("forwards ref to the underlying button element", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Switch aria-label="toggle" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current).toBe(screen.getByRole("switch"));
  });

  it("toggles and fires onCheckedChange when clicked", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<Switch aria-label="Include expired items" onCheckedChange={handleChange} />);
    const el = screen.getByRole("switch");

    await user.click(el);
    expect(handleChange).toHaveBeenCalledWith(true);
    expect(el).toHaveAttribute("aria-checked", "true");

    await user.click(el);
    expect(handleChange).toHaveBeenCalledWith(false);
    expect(el).toHaveAttribute("aria-checked", "false");
  });

  it("is keyboard-operable via Space", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<Switch aria-label="toggle" onCheckedChange={handleChange} />);
    const el = screen.getByRole("switch");

    el.focus();
    expect(el).toHaveFocus();
    await user.keyboard(" ");

    expect(handleChange).toHaveBeenCalledWith(true);
    expect(el).toHaveAttribute("aria-checked", "true");
  });

  it("pairs correctly with <Label htmlFor>", () => {
    render(
      <div>
        <Label htmlFor="expiring-toggle">Prioritize expiring food</Label>
        <Switch id="expiring-toggle" />
      </div>
    );
    expect(screen.getByLabelText("Prioritize expiring food")).toHaveAttribute("role", "switch");
  });

  it("supports controlled checked state via aria-checked", () => {
    render(<Switch aria-label="toggle" checked readOnly />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("respects disabled", () => {
    render(<Switch aria-label="toggle" disabled />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
