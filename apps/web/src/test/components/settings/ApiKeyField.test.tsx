import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiKeyField } from "@/components/settings/ApiKeyField";

// A key that must never appear anywhere in the rendered DOM — this component never
// receives the real key (the server is write-only, plan §6.2), so this constant only
// exists to give the "never rendered" assertions something concrete to check against.
const FULL_KEY = "sk-live-THIS-MUST-NEVER-RENDER-abcdef7f2c";

describe("ApiKeyField", () => {
  it("renders a masked placeholder for a configured key, never the full key", () => {
    render(
      <ApiKeyField
        keyConfigured
        keyLast4="7f2c"
        isReplacing={false}
        value=""
        onValueChange={vi.fn()}
        onStartReplace={vi.fn()}
        onCancelReplace={vi.fn()}
      />
    );
    expect(screen.getByText("••••7f2c")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(FULL_KEY);
    expect(document.body.textContent).not.toContain("sk-live");
  });

  it("shows 'no key configured' plus an Add button when no key is stored", () => {
    render(
      <ApiKeyField
        keyConfigured={false}
        keyLast4={null}
        isReplacing={false}
        value=""
        onValueChange={vi.fn()}
        onStartReplace={vi.fn()}
        onCancelReplace={vi.fn()}
      />
    );
    expect(screen.getByText(/no api key configured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add api key/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /replace/i })).not.toBeInTheDocument();
  });

  it("clicking Replace notifies the parent to enter replace mode", async () => {
    const user = userEvent.setup();
    const onStartReplace = vi.fn();
    render(
      <ApiKeyField
        keyConfigured
        keyLast4="7f2c"
        isReplacing={false}
        value=""
        onValueChange={vi.fn()}
        onStartReplace={onStartReplace}
        onCancelReplace={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /replace/i }));
    expect(onStartReplace).toHaveBeenCalledTimes(1);
  });

  it("in replace mode, renders a labeled password input with no reveal toggle", () => {
    render(
      <ApiKeyField
        keyConfigured
        keyLast4="7f2c"
        isReplacing
        value=""
        onValueChange={vi.fn()}
        onStartReplace={vi.fn()}
        onCancelReplace={vi.fn()}
      />
    );
    const input = screen.getByLabelText(/new api key/i);
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autoComplete", "off");
    expect(screen.queryByRole("button", { name: /show|reveal/i })).not.toBeInTheDocument();
    // Never re-shows the masked value as if it were editable text.
    expect(screen.queryByText("••••7f2c")).not.toBeInTheDocument();
  });

  it("typing into the replace input calls onValueChange with what was typed", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <ApiKeyField
        keyConfigured
        keyLast4="7f2c"
        isReplacing
        value=""
        onValueChange={onValueChange}
        onStartReplace={vi.fn()}
        onCancelReplace={vi.fn()}
      />
    );
    await user.type(screen.getByLabelText(/new api key/i), "x");
    expect(onValueChange).toHaveBeenCalledWith("x");
  });

  it("Cancel in replace mode returns control to the parent without a Remove action", async () => {
    const user = userEvent.setup();
    const onCancelReplace = vi.fn();
    render(
      <ApiKeyField
        keyConfigured
        keyLast4="7f2c"
        isReplacing
        value="typed-so-far"
        onValueChange={vi.fn()}
        onStartReplace={vi.fn()}
        onCancelReplace={onCancelReplace}
      />
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancelReplace).toHaveBeenCalledTimes(1);
  });
});
