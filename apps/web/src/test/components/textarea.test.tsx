import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

describe("Textarea", () => {
  it("renders a textbox", () => {
    render(<Textarea aria-label="Custom prompt" />);
    expect(screen.getByRole("textbox", { name: "Custom prompt" })).toBeInTheDocument();
  });

  it("forwards className and composes with the base classes", () => {
    render(<Textarea aria-label="Custom prompt" className="font-mono text-sm min-h-64" />);
    const el = screen.getByRole("textbox");
    expect(el).toHaveClass("font-mono");
    expect(el).toHaveClass("text-sm");
    expect(el).toHaveClass("min-h-64");
    // base treatment classes still present alongside the override
    expect(el).toHaveClass("rounded-md");
    expect(el).toHaveClass("border-input");
  });

  it("forwards ref to the underlying textarea element", () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    render(<Textarea aria-label="Custom prompt" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("accepts typed input and calls onChange", async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="Custom prompt" />);
    const el = screen.getByRole("textbox");
    await user.type(el, "Use up the spinach first");
    expect(el).toHaveValue("Use up the spinach first");
  });

  it("pairs correctly with <Label htmlFor>", () => {
    render(
      <div>
        <Label htmlFor="custom-prompt">Custom prompt</Label>
        <Textarea id="custom-prompt" />
      </div>
    );
    expect(screen.getByLabelText("Custom prompt")).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("respects disabled", () => {
    render(<Textarea aria-label="Custom prompt" disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
