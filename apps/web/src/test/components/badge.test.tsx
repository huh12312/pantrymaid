import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Pantry</Badge>);
    expect(screen.getByText("Pantry")).toBeInTheDocument();
  });

  it("defaults to the default variant classes", () => {
    render(<Badge>Default</Badge>);
    const el = screen.getByText("Default");
    expect(el).toHaveClass("bg-primary");
    expect(el).toHaveClass("text-primary-foreground");
  });

  it("renders the secondary variant", () => {
    render(<Badge variant="secondary">Secondary</Badge>);
    const el = screen.getByText("Secondary");
    expect(el).toHaveClass("bg-secondary");
    expect(el).toHaveClass("text-secondary-foreground");
  });

  it("renders the outline variant", () => {
    render(<Badge variant="outline">Outline</Badge>);
    const el = screen.getByText("Outline");
    expect(el).toHaveClass("text-foreground");
    expect(el).not.toHaveClass("bg-primary");
  });

  it("renders the warning variant using the amber/expiring semantic token", () => {
    render(<Badge variant="warning">Expiring</Badge>);
    const el = screen.getByText("Expiring");
    expect(el).toHaveClass("text-warning");
    expect(el.className).toMatch(/bg-warning\/15/);
  });

  it("forwards className alongside variant classes", () => {
    render(
      <Badge variant="warning" className="my-extra-class">
        Expiring
      </Badge>
    );
    const el = screen.getByText("Expiring");
    expect(el).toHaveClass("my-extra-class");
    expect(el).toHaveClass("text-warning");
  });

  it("forwards ref to the underlying span element", () => {
    const ref = { current: null as HTMLSpanElement | null };
    render(<Badge ref={ref}>Ref</Badge>);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });

  it("is not focusable (presentational, not an interactive control)", () => {
    render(<Badge>Status</Badge>);
    const el = screen.getByText("Status");
    expect(el).not.toHaveAttribute("tabindex");
    expect(el.tagName).toBe("SPAN");
  });
});
