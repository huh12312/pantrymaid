import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateInput } from "@/components/ui/DateInput";
import { Label } from "@/components/ui/label";

// Local harness: mirrors DateInput's emitted value back in as `value`, the
// way a real form would, and exposes a button to simulate an *external*
// write (preset button, AI suggestion, edit-mode prefill) so the echo-guard
// can be exercised distinctly from the user's own typing.
function Harness({
  initialValue = "",
  externalValue,
}: {
  initialValue?: string;
  externalValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [lastMeta, setLastMeta] = useState<{ partial: boolean } | null>(null);
  return (
    <div>
      <Label htmlFor="expirationDate">Expiry Date</Label>
      <DateInput
        id="expirationDate"
        value={value}
        onChange={(v, meta) => {
          setValue(v);
          setLastMeta(meta);
        }}
      />
      <div data-testid="form-value">{value}</div>
      <div data-testid="last-partial">{lastMeta ? String(lastMeta.partial) : ""}</div>
      {externalValue !== undefined && (
        <button type="button" onClick={() => setValue(externalValue)}>
          apply external value
        </button>
      )}
    </div>
  );
}

describe("DateInput", () => {
  it("typing 08162026 emits the final canonical date; all 7 intermediate emissions are '' with partial: true", async () => {
    // This is the assertion that locks in the blur-deferral design: typing
    // 8 digits passes through 4-digit ("0816") and 6-digit ("081620")
    // states that `digitsToCanonical` *would* resolve (to 2016-08-31 and
    // 2020-08-16 respectively) if the keystroke path resolved short forms
    // eagerly. It must not — those would be bogus transient values in form
    // state. Only the 8th keystroke may resolve.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DateInput id="expirationDate" value="" onChange={onChange} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "08162026");

    expect(onChange).toHaveBeenCalledTimes(8);
    for (const call of onChange.mock.calls.slice(0, 7)) {
      expect(call[0]).toBe("");
      expect(call[1]).toEqual({ partial: true });
    }
    expect(onChange.mock.calls[7]).toEqual(["2026-08-16", { partial: false }]);
    expect(input).toHaveValue("08/16/2026");
  });

  it("emits partial: true with canonical '' while mid-typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DateInput id="expirationDate" value="" onChange={onChange} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "081");

    // Every call so far should have been canonical "" / partial true.
    for (const call of onChange.mock.calls) {
      expect(call[0]).toBe("");
      expect(call[1]).toEqual({ partial: true });
    }
    expect(onChange).toHaveBeenCalled();
  });

  it("partial 0816 stays '' without a blur", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i);

    await user.type(input, "0816");

    expect(screen.getByTestId("form-value")).toHaveTextContent("");
    expect(input).toHaveValue("08/16");
  });

  it("6-digit 081626 resolves to 2026-08-16 on blur", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness />
        <button type="button">elsewhere</button>
      </div>
    );
    const input = screen.getByLabelText(/expiry date/i);

    await user.type(input, "081626");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");

    await user.tab();

    expect(screen.getByTestId("form-value")).toHaveTextContent("2026-08-16");
    expect(input).toHaveValue("08/16/2026");
  });

  it("4-digit 0826 resolves to the end of August on blur", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness />
        <button type="button">elsewhere</button>
      </div>
    );
    const input = screen.getByLabelText(/expiry date/i);

    await user.type(input, "0826");
    await user.tab();

    expect(screen.getByTestId("form-value")).toHaveTextContent("2026-08-31");
    expect(input).toHaveValue("08/31/2026");
    expect(screen.getByText(/set to end of aug 2026/i)).toBeInTheDocument();
  });

  it("backspace with a collapsed caret right after a '/' removes the digit, not the separator, and the caret lands after the shifted digit", async () => {
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "0816", selectionStart: 4 } });
    expect(input.value).toBe("08/16");
    // Caret positioned right after the "/" (index 3 of "08/16").
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: "Backspace" });

    // The "8" (second digit of the month) was removed, not the "/", and the
    // digit-index caret mapping (not a raw character index, which would be
    // thrown off by the "/" insertion/removal) lands the caret right after
    // the digit that shifted into its place.
    expect(input.value).toBe("01/6");
    expect(input.selectionStart).toBe(1);
    expect(screen.getByTestId("form-value")).toHaveTextContent("");
  });

  it("delete with a collapsed caret removes the following digit, not a separator", () => {
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "0816", selectionStart: 4 } });
    expect(input.value).toBe("08/16");
    // Caret right before the "1" of "16" (index 3).
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: "Delete" });

    // Removes the "1", not the "/" to its left.
    expect(input.value).toBe("08/6");
  });

  it("mid-string insertion maps the caret by digit index, not by character index", () => {
    render(<Harness initialValue="2026-08-16" />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;
    expect(input.value).toBe("08/16/2026");

    // Insert a "0" between the "0" and "8" of the month (raw DOM value after
    // the browser splices the keystroke in at position 1).
    fireEvent.change(input, {
      target: { value: "008/16/2026", selectionStart: 2 },
    });

    // Digits are now "00816202" (truncated to 8). The caret was after the
    // 2nd digit, so after the mask reflows and inserts two new "/"
    // separators, the caret must still land right after that same 2nd
    // digit — derived by walking the reformatted string counting digits,
    // not by reusing the raw DOM character offset.
    expect(input.value).toBe("00/81/6202");
    expect(input.selectionStart).toBe(2);
  });

  it("pastes '08/16/2026' and resolves immediately", async () => {
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;
    input.focus();

    fireEvent.paste(input, {
      clipboardData: { getData: () => "08/16/2026" },
    });

    expect(input.value).toBe("08/16/2026");
    expect(screen.getByTestId("form-value")).toHaveTextContent("2026-08-16");
  });

  it("pastes bare ISO '2026-08-16' and resolves immediately", async () => {
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;
    input.focus();

    fireEvent.paste(input, {
      clipboardData: { getData: () => "2026-08-16" },
    });

    expect(input.value).toBe("08/16/2026");
    expect(screen.getByTestId("form-value")).toHaveTextContent("2026-08-16");
  });

  it("pastes a 4-digit short form '08/26' and resolves the canonical value immediately, without a blur", () => {
    // Paste is a committed action (commitShortForm: true in handlePaste),
    // unlike the keystroke path which defers 4/6-digit resolution to blur.
    // Coverage on `applyDigits`'s commitShortForm branch was previously
    // 100% dead — no existing test reached it via paste. Note: unlike the
    // blur path (which explicitly re-displays as isoToDisplay(canonical)),
    // applyDigits always sets display from formatDigits(digits) — the raw
    // typed/pasted digits, not the resolved date — so the visible text
    // stays "08/26" even though the canonical value has resolved to end of
    // August. That's existing, unchanged behavior; this test locks in the
    // canonical-resolves-without-blur guarantee, not the display format.
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;
    input.focus();

    fireEvent.paste(input, {
      clipboardData: { getData: () => "08/26" },
    });

    expect(input.value).toBe("08/26");
    expect(screen.getByTestId("form-value")).toHaveTextContent("2026-08-31");
    expect(screen.getByTestId("last-partial")).toHaveTextContent("false");
  });

  it("pastes a 6-digit short form '08/16/26' and resolves the canonical value immediately, without a blur", () => {
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;
    input.focus();

    fireEvent.paste(input, {
      clipboardData: { getData: () => "08/16/26" },
    });

    expect(input.value).toBe("08/16/26");
    expect(screen.getByTestId("form-value")).toHaveTextContent("2026-08-16");
    expect(screen.getByTestId("last-partial")).toHaveTextContent("false");
  });

  it("rejects month 13", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i);

    await user.type(input, "13162026");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");

    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a complete date");
  });

  it("rejects 02/31", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i);

    await user.type(input, "02312026");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");

    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a complete date");
  });

  it("accepts 02/29/2024 (leap year)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i);

    await user.type(input, "02292024");

    expect(screen.getByTestId("form-value")).toHaveTextContent("2024-02-29");
  });

  it("rejects 02/29/2026 (not a leap year)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i);

    await user.type(input, "02292026");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");

    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a complete date");
  });

  it("invalid 4-digit short form on blur shows the error and does not resolve a bogus date", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness />
        <button type="button">elsewhere</button>
      </div>
    );
    const input = screen.getByLabelText(/expiry date/i);

    // "13" is not a valid month in the MM/YY short form.
    await user.type(input, "1399");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");

    await user.tab();

    expect(screen.getByTestId("form-value")).toHaveTextContent("");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a complete date");
  });

  it("backspace with a range selection falls through to the browser default and re-derives correctly", () => {
    // handleKeyDown only intercepts a COLLAPSED caret (selStart === selEnd);
    // with a real selection range it must return early and let the browser
    // apply its own default edit, which then flows through the normal
    // onChange -> applyDigits re-derivation path.
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "0816", selectionStart: 4 } });
    expect(input.value).toBe("08/16");

    // Select "08/1" (range, not collapsed) and press Backspace. handleKeyDown
    // must NOT preventDefault/handle this itself — it should be a no-op that
    // lets the (simulated) browser default proceed, which we simulate here
    // via the change event a real browser would fire after deleting the
    // selected range.
    input.setSelectionRange(0, 4);
    // dispatchEvent (what fireEvent returns) is `true` only when the event's
    // default was NOT prevented — the direct signal that handleKeyDown took
    // its early-return branch rather than its e.preventDefault() branch.
    const notPrevented = fireEvent.keyDown(input, { key: "Backspace" });
    expect(notPrevented).toBe(true);
    // jsdom does not apply the native edit for us; verify handleKeyDown did
    // not itself mutate the value (no preventDefault path taken).
    expect(input.value).toBe("08/16");

    // Now simulate the browser's own post-deletion change event: the
    // selected range "08/1" removed, leaving "6".
    fireEvent.change(input, { target: { value: "6", selectionStart: 1 } });
    expect(input.value).toBe("6");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");
  });

  it("delete with a range selection falls through to the browser default and re-derives correctly", () => {
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "0816", selectionStart: 4 } });
    expect(input.value).toBe("08/16");

    input.setSelectionRange(0, 4);
    const notPrevented = fireEvent.keyDown(input, { key: "Delete" });
    expect(notPrevented).toBe(true);
    expect(input.value).toBe("08/16");

    fireEvent.change(input, { target: { value: "6", selectionStart: 1 } });
    expect(input.value).toBe("6");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");
  });

  it("clearing the field returns ''", async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="2026-08-16" />);
    const input = screen.getByLabelText(/expiry date/i);

    expect(input).toHaveValue("08/16/2026");
    await user.clear(input);

    expect(input).toHaveValue("");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");
    expect(screen.getByTestId("last-partial")).toHaveTextContent("false");
  });

  it("renders a programmatic external value change as formatted display", () => {
    render(<Harness initialValue="" externalValue="2026-08-16" />);
    const input = screen.getByLabelText(/expiry date/i);

    expect(input).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /apply external value/i }));

    expect(input).toHaveValue("08/16/2026");
  });

  it("echo-guard: overwriting a resolved date with a partial edit is not wiped by the parent's own echo", () => {
    // Start from a RESOLVED value so `value` genuinely transitions
    // ("2026-08-16" -> "") the moment the user overwrites it. A Harness
    // that starts empty never exercises the guard: `value` never changes
    // (React bails on an unchanged primitive) while mid-typing emissions
    // are already "". The bug this guards against needs a real date -> ""
    // transition landing in the SAME render cycle the component's own
    // `display` state was just set to something non-empty.
    render(<Harness initialValue="2026-08-16" externalValue="2026-08-16" />);
    const input = screen.getByLabelText(/expiry date/i) as HTMLInputElement;
    expect(input).toHaveValue("08/16/2026");

    // Simulate the user selecting all existing text and typing "0" over
    // it: the DOM's post-replacement raw value is "0". This is the first
    // keystroke that drives `value` from "2026-08-16" down to "".
    fireEvent.change(input, { target: { value: "0", selectionStart: 1 } });

    // A naive `useEffect(() => setDisplay(...), [value])` would see `value`
    // change to "" here and wipe the "0" the component's own handleChange
    // just wrote to `display`.
    expect(input).toHaveValue("0");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");

    fireEvent.change(input, { target: { value: "08", selectionStart: 2 } });
    fireEvent.change(input, { target: { value: "081", selectionStart: 3 } });
    fireEvent.change(input, { target: { value: "0816", selectionStart: 4 } });

    expect(input).toHaveValue("08/16");
    expect(screen.getByTestId("form-value")).toHaveTextContent("");

    // A later, genuinely external write (preset / AI suggestion / edit-mode
    // prefill) must still land and override the in-progress partial text.
    fireEvent.click(screen.getByRole("button", { name: /apply external value/i }));
    expect(input).toHaveValue("08/16/2026");
    expect(screen.getByTestId("form-value")).toHaveTextContent("2026-08-16");
  });

  it("getByLabelText resolves via <Label htmlFor>", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/expiry date/i)).toBeInTheDocument();
  });

  it("has inputMode=numeric", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/expiry date/i)).toHaveAttribute("inputMode", "numeric");
  });

  it("shows an error and keeps the text on blur with incomplete input", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness />
        <button type="button">elsewhere</button>
      </div>
    );
    const input = screen.getByLabelText(/expiry date/i);

    await user.type(input, "081");
    await user.tab();

    expect(input).toHaveValue("08/1");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a complete date");
  });

  it("does not render role=spinbutton", () => {
    render(<Harness />);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("always renders the alert element, empty when there is no error", () => {
    render(<Harness />);
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });

  it("wires aria-describedby to the error id, and to the hint id once a date resolves", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/expiry date/i);

    await user.type(input, "08162026");

    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("-date-error");
    expect(describedBy).toContain("-date-hint");
  });
});
