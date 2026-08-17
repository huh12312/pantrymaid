import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import {
  describeExpiry,
  digitsToCanonical,
  formatDigits,
  isoToDisplay,
  monthAbbreviation,
  parseLocalDate,
} from "@/lib/dates";

interface DateInputProps {
  id?: string;
  /** Canonical "YYYY-MM-DD", or "". Never a Date object. */
  value: string;
  /**
   * `meta.partial` is TRUE when the user has typed something that has not
   * (yet) resolved to a valid date — display text is non-empty but the
   * canonical value is "". The parent uses this to avoid clobbering
   * in-progress typing (e.g. a preset button should not overwrite a
   * half-typed date).
   */
  onChange: (value: string, meta: { partial: boolean }) => void;
  "aria-describedby"?: string;
}

export interface DateInputHandle {
  /**
   * Force-resolves pending short-form input (the 4/6-digit forms that
   * normally only resolve on blur), so a submit triggered without a blur
   * — e.g. pressing Enter — doesn't silently drop a valid date.
   * Returns "" when the field is genuinely empty, the canonical
   * "YYYY-MM-DD" when it resolves, or null when text is present but
   * cannot be resolved.
   */
  resolvePending(): string | null;
  focus(): void;
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

function countDigits(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c >= "0" && c <= "9") n++;
  }
  return n;
}

/**
 * Maps a "how many digits precede the caret" count to a caret offset in the
 * formatted (slash-inserted) string, by walking the string and counting
 * digits rather than reusing a raw character index. A character index would
 * be wrong the instant a "/" is inserted or removed, since that shifts every
 * character after it.
 */
function caretOffsetForDigitCount(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    const ch = formatted.charAt(i);
    if (ch >= "0" && ch <= "9") {
      seen++;
      if (seen === digitCount) return i + 1;
    }
  }
  return formatted.length;
}

/**
 * Load-bearing render assumption, recorded here so a future `React.memo`
 * "optimization" doesn't silently break this component:
 *
 * Both the hint text below (read from `lastEmitted.current` — a ref — during
 * render) and the caret-restore `useLayoutEffect` (no dependency array,
 * gated only by the `pendingCaret` ref) are correct ONLY because this
 * component is never wrapped in `React.memo` and the parent's `onChange`
 * always builds a new `formData` object, which guarantees a re-render after
 * every ref mutation this component makes. `forwardRef` (used below for the
 * imperative handle) is not memoization and does not affect this — but if
 * anyone adds `React.memo(DateInput)` later, a parent-driven mutation that
 * doesn't also change a *prop* (e.g. two consecutive keystrokes that
 * reformat to byte-identical output) could stop re-rendering, and the hint
 * text / caret position would go stale. Don't add memoization here without
 * re-deriving both from state instead of refs.
 */
export const DateInput = forwardRef<DateInputHandle, DateInputProps>(function DateInput(
  { id, value, onChange, "aria-describedby": ariaDescribedByProp },
  forwardedRef
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-date-hint`;
  const errorId = `${fieldId}-date-error`;

  const [display, setDisplay] = useState<string>(() => (value ? isoToDisplay(value) : ""));
  const [error, setError] = useState("");
  // True only when the currently-resolved canonical value came from a
  // 4-digit MM/YY entry auto-completed to the last day of the month — used
  // only to annotate the hint text, cleared on any subsequent edit.
  const [resolvedFromMonthYear, setResolvedFromMonthYear] = useState(false);

  // Tracks the last value *this component* emitted upward, so the echo-guard
  // effect below can tell "the parent wrote a genuinely new value" apart
  // from "the parent is just echoing back what we told it". Seeded with the
  // incoming `value`, not "", so mounting doesn't trigger a spurious resync.
  const lastEmitted = useRef<string>(value);
  const pendingCaret = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Echo-guard. Without the `lastEmitted` comparison, a naive
  // `useEffect(() => setDisplay(...), [value])` eats the user's own typing:
  // user types "0", this component emits "" upward, the parent stores "",
  // "" flows back down as a changed `value`, and the effect wipes the "0".
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setDisplay(value ? isoToDisplay(value) : "");
      setError("");
      setResolvedFromMonthYear(false);
    }
  }, [value]);

  // Caret restoration. Deliberately no dependency array: typing a
  // non-digit character gets stripped before it ever reaches state, so the
  // reformatted output can be byte-identical to what was already rendered.
  // An effect gated on `[display]` would then never fire — but React has
  // already reconciled the controlled <input> and the browser already reset
  // the caret to the end. Running after every commit (guarded by the ref,
  // so it's a no-op on renders that didn't touch the caret) and using
  // useLayoutEffect (not useEffect) means the caret is repositioned before
  // paint, so it never visibly snaps.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    inputRef.current?.setSelectionRange(pos, pos);
  });

  const applyDigits = (digits: string, opts: { commitShortForm: boolean }) => {
    const formatted = formatDigits(digits);
    setDisplay(formatted);

    let canonical = "";
    let monthYear = false;
    if (digits.length === 8) {
      canonical = digitsToCanonical(digits);
    } else if (opts.commitShortForm && (digits.length === 4 || digits.length === 6)) {
      canonical = digitsToCanonical(digits);
      monthYear = digits.length === 4 && canonical !== "";
    }

    setResolvedFromMonthYear(monthYear);
    setError("");
    lastEmitted.current = canonical;
    onChange(canonical, { partial: formatted !== "" && canonical === "" });
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const caret = e.target.selectionStart ?? raw.length;
    const digitsBeforeCaret = countDigits(raw.slice(0, caret));
    const digits = onlyDigits(raw).slice(0, 8);
    const targetDigitIndex = Math.min(digitsBeforeCaret, digits.length);
    pendingCaret.current = caretOffsetForDigitCount(formatDigits(digits), targetDigitIndex);
    // Keystroke path: short forms (4/6 digits) stay unresolved until blur or
    // paste, so a transient mid-typing state (e.g. "0816" alone) never
    // resolves to a plausible-but-wrong date while the user is still typing
    // toward the full 8 digits.
    applyDigits(digits, { commitShortForm: false });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    const el = e.currentTarget;
    const selStart = el.selectionStart ?? 0;
    const selEnd = el.selectionEnd ?? 0;
    if (selStart !== selEnd) return; // range selection: let the browser default fire, onChange re-derives

    e.preventDefault();
    const digits = onlyDigits(display);
    const caretDigitsBefore = countDigits(display.slice(0, selStart));

    let removeIndex: number;
    let newCaretDigitIndex: number;
    if (e.key === "Backspace") {
      if (caretDigitsBefore === 0) return;
      removeIndex = caretDigitsBefore - 1;
      newCaretDigitIndex = caretDigitsBefore - 1;
    } else {
      if (caretDigitsBefore >= digits.length) return;
      removeIndex = caretDigitsBefore;
      newCaretDigitIndex = caretDigitsBefore;
    }

    const newDigits = digits.slice(0, removeIndex) + digits.slice(removeIndex + 1);
    pendingCaret.current = caretOffsetForDigitCount(formatDigits(newDigits), newCaretDigitIndex);
    applyDigits(newDigits, { commitShortForm: false });
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").trim();
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

    let digits: string;
    if (isoMatch) {
      const y = isoMatch[1] ?? "";
      const m = isoMatch[2] ?? "";
      const d = isoMatch[3] ?? "";
      digits = `${m}${d}${y}`;
    } else {
      digits = onlyDigits(text).slice(0, 8);
    }

    pendingCaret.current = formatDigits(digits).length;
    // Paste is a committed action, not mid-typing, so short forms (4/6
    // digits) resolve immediately instead of waiting for blur.
    applyDigits(digits, { commitShortForm: true });
  };

  // Shared by handleBlur and the imperative resolvePending() handle: forces
  // resolution of a pending 4/6-digit short form that the keystroke path
  // deliberately left uncommitted (see applyDigits). Returns "" when the
  // field is genuinely empty, the canonical "YYYY-MM-DD" once resolved
  // (updating display/lastEmitted/error/onChange exactly as blur always
  // has), or null when there's text present that still can't be resolved.
  const resolveShortForm = (): string | null => {
    if (display === "") {
      setError("");
      return "";
    }
    if (lastEmitted.current !== "") {
      // Already resolved (full 8 digits, or a short form resolved earlier).
      setError("");
      return lastEmitted.current;
    }

    const digits = onlyDigits(display);
    if (digits.length === 4 || digits.length === 6) {
      const canonical = digitsToCanonical(digits);
      if (canonical !== "") {
        const monthYear = digits.length === 4;
        setDisplay(isoToDisplay(canonical));
        setResolvedFromMonthYear(monthYear);
        setError("");
        lastEmitted.current = canonical;
        onChange(canonical, { partial: false });
        return canonical;
      }
    }

    setError("Enter a complete date");
    return null;
  };

  const handleBlur = () => {
    resolveShortForm();
  };

  useImperativeHandle(forwardedRef, () => ({
    resolvePending: resolveShortForm,
    focus: () => inputRef.current?.focus(),
  }));

  let hint = "";
  if (lastEmitted.current) {
    const relative = describeExpiry(lastEmitted.current);
    if (resolvedFromMonthYear) {
      const dt = parseLocalDate(lastEmitted.current);
      hint = dt
        ? `Set to end of ${monthAbbreviation(dt.getMonth())} ${dt.getFullYear()} · ${relative}`
        : relative;
    } else {
      hint = relative;
    }
  }

  const describedBy =
    [ariaDescribedByProp, hint ? hintId : null, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <Input
        id={id}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM/DD/YYYY"
        value={display}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={handleBlur}
        aria-describedby={describedBy}
        aria-invalid={error !== ""}
      />
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {/* Always rendered (even when empty) — a live region added to the DOM
          at the same time as its content is not reliably announced. */}
      <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
        {error}
      </p>
    </>
  );
});
