---
title: Typed numeric entry for expiry dates
status: implemented
created: 2026-08-16
completed: 2026-08-17
area: apps/web
tags: [feature, frontend, expiry-date]
---

> **Implemented.** Decisions A/B/C resolved as recommended: all three formats
> (8-digit, 6-digit, month-only), calendar escape hatch deferred, live hint
> shipped. Quick-chips and the field reorder were NOT built — see "Not done".
>
> Two deviations found during review, both deliberate:
>
> - **Submit is blocked on unresolvable text**, contrary to the "never block"
>   line below. Short forms only resolve on blur, and Enter submits _without_
>   blurring — so `0826` + Enter silently saved no date (create) or wiped the
>   existing one (edit). `DateInput` now exposes `resolvePending()` via a ref;
>   `handleSubmit` force-resolves before building the payload and blocks with an
>   inline error only when the text genuinely cannot resolve. An empty field
>   still submits fine, so the field stays optional.
> - **Quick-chips, the `expirationEstimated` badge, receipt-sheet reuse, and the
>   field reorder were not built.** The estimated flag is now _persisted_
>   correctly, but nothing surfaces it in the UI yet.

# Typed numeric entry for expiry dates

## Problem

`AddItemDialog.tsx:528-536` renders a bare `<input type="date">`. On iOS Safari and
Android Chrome this forces the OS picker wheel — you cannot type the digits. The primary
use case is a user standing in the kitchen reading `08/2026` off a carton, one-handed.
Scrolling a wheel to August 2026 is several times slower than typing four digits.

## Approach: one masked text input, no new dependency

Four specialists (React, UX, accessibility, QA) converged independently on a **single
masked `<input type="text" inputMode="numeric">`** over three MM/DD/YYYY segment inputs.
The reasons stack rather than overlap:

- **Accessibility surface.** Segments require `role="group"` + per-segment `aria-label`
  - a visually-hidden `<legend>`, and iOS VoiceOver has a known bug where it does not
    announce the group label when navigating into a child segment. A single input keeps
    the existing 1:1 `<Label htmlFor="expirationDate">` binding untouched.
- **`e2e/a11y.spec.ts:37-53`** runs axe against the opened dialog and asserts
  `violations).toEqual([])`. Three segments with one label = an axe `label` violation =
  red CI. A single input is safe by construction.
- **Focus management.** Segments need programmatic `.focus()` on auto-advance, inside a
  Radix Dialog focus trap, on a mobile browser that re-scrolls the visual viewport on
  every focus hop. Three fragile things multiplied together.
- **Paste and backspace** are one handler on one element instead of three coordinated ones.

No dependency. `apps/web/package.json` has React 19.2.5 and zero date/mask libraries;
this is ~100 lines of local, unit-testable pure logic.

### New file: `apps/web/src/components/ui/DateInput.tsx`

Props: `{ id?: string; value: string; onChange: (v: string) => void }`, where `value` is
canonical `"YYYY-MM-DD"` or `""`.

**Invariant, non-negotiable:** form state stays canonical `"YYYY-MM-DD"` or `""`. Never a
`Date` object. This already holds today — `AddItemDialog.tsx:85-87` and `:209-211` both
do `.toISOString().split("T")[0]` — so no call site outside the field itself changes.

Three problems the implementer must get right:

**1. Caret placement.** Saving and restoring `selectionStart` as a _character_ index is
the standard wrong answer: inserting a `/` shifts every character after it. Map by
**digit index** instead — count digits before the caret, reformat, then walk the formatted
string to find the offset after the Nth digit.

Restore in a `useLayoutEffect` **with no dependency array**. Gating it on `[display]`
breaks a real case: type a letter, it gets stripped, the formatted output is byte-identical,
`display` never changes, the effect never fires — but React already reconciled the
controlled input and the browser reset the caret to the end. `useLayoutEffect` not
`useEffect`, or the caret visibly snaps.

**2. Echo-guard.** `handlePresetSelect` (`:207-219`) and the AI-suggest path (`:79-91`)
write into `formData.expirationDate` from outside. A naive `useEffect(..., [value])` that
resyncs display from `value` will eat the user's own partial typing: user types `0`,
component emits `""` upward, `""` flows back down as a changed `value`, effect wipes the `0`.
Fix with a `lastEmitted` ref — only resync when `value !== lastEmitted.current`.

**3. Validity.** Round-trip validate via `Date.UTC(y, m-1, d)` and read back
`getUTC*` — JS silently rolls `02/30` forward otherwise. Build the canonical string by
**string concatenation** of the already-validated parts. Do _not_ add a third
`.toISOString()` call site; see the timezone bug below.

While the user is mid-typing, the component emits `""` upward and keeps the partial text
in its own `display` state. `handleSubmit`'s existing `|| undefined` coercion
(`:222-229`) is unchanged.

### Call site

```tsx
<Label htmlFor="expirationDate">Expiry Date</Label>
<DateInput
  id="expirationDate"
  value={formData.expirationDate || ""}
  onChange={(expirationDate) => setFormData((prev) => ({ ...prev, expirationDate }))}
/>
```

## Accessibility requirements

Replacing a native input forfeits browser-provided semantics. Required to stay WCAG 2.1 AA:

- Keep `<Label htmlFor>` → `id` 1:1. No fieldset needed with the single-input design.
- `aria-describedby` chains a **static** hint (`"MM/DD/YYYY"` + "expires in N days") and a
  **live** error region. The hint must NOT be a live region — it would re-announce on
  every keystroke. The error region node must exist in the DOM before its content changes,
  or the announcement is missed entirely; render it empty rather than conditionally.
- Debounce validation ~500ms before populating the error region.
- **Omit `role="spinbutton"`.** A spinbutton with a stale `aria-valuenow` is worse than no
  role — VoiceOver tells the user to swipe to adjust and nothing happens.
- **Omit arrow-key increment.** It conflicts with caret movement in a masked input and is
  the single largest source of keyboard-a11y bugs in custom date controls.
- `inputMode="numeric"` has no AT downside. Do not use `type="number"` — that reintroduces
  spinbutton semantics.
- Tab must exit the field normally. No keyboard trap (WCAG 2.1.2).
- Keep the existing `h-11 sm:h-10` sizing (44px mobile — already meets 2.5.5 AAA).

**One unresolved tension, flagged not buried:** the a11y analysis warns that calling
`setSelectionRange()` on every keystroke can cause NVDA to re-announce the whole input
value, and suggests deferring separator insertion to blur. That contradicts the
live-masking design, which is what makes the field feel responsive.

Accept live masking as a known, low-probability **desktop** risk. It affects NVDA/JAWS on
Windows specifically; this is a mobile-first app, and there is no way to verify it from
this dev environment (Linux) — axe in `e2e/a11y.spec.ts` checks markup, not announcement
behavior. Not a release gate, since nobody here can clear it. If a Windows screen-reader
user reports it, the fallback is inserting separators on blur only — a contained change
inside one component.

## Timezone — the highest-risk regression class

`playwright.config.ts` sets **no `timezoneId`**. CI runners are UTC; Chris's machine is
`America/New_York`. CI and local already silently disagree on every date boundary, before
this change. Add `timezoneId: "America/New_York"` to the shared `use` block.

Pin **two** zones in Vitest, because the two bug directions are mutually invisible:

- `America/New_York` (UTC-4) catches `new Date("2026-08-16")` parsing as UTC midnight and
  displaying a day early — the bug `ItemCard.tsx:32-34` hand-patches with `+ "T00:00:00"`.
- `Asia/Tokyo` (UTC+9) catches `.toISOString().split("T")[0]` rolling a date _forward_.

Set `TZ` at the process level in the `test` script, not in `setup.ts` — mutating
`process.env.TZ` after V8's `Date`/`Intl` internals initialize is unreliable.

### Pre-existing bug this will expose

`AddItemDialog.tsx:85-87` and `:209-211` compute
`new Date(Date.now() + n*86400000).toISOString().split("T")[0]`. Select a 7-day preset at
23:30 local in NC and you get a date **8 days out**, because `toISOString()` converts to
UTC where it's already tomorrow. This is live today, hidden inside the opaque native
picker. The new control renders the wrong date in plain text, so it becomes visible.

Fix in the same PR: compute the offset date in local time and build the string from
`getFullYear/getMonth/getDate`, not `toISOString()`. Extract as a shared helper alongside
the parse/format functions so `ItemCard.tsx:32-34`'s `+ "T00:00:00"` workaround can be
deleted rather than duplicated.

**The shared parse helper must still accept a `T`-suffixed value.** That branch is dead
for current data — `server/src/db/schema.ts:104` declares `date()` with no `mode`, so
Drizzle returns a bare `"YYYY-MM-DD"` string and the route only reshapes `quantity` — but
it is the guard against any future path producing an ISO timestamp (e.g. response
validation through `itemSchema`'s `z.coerce.date()`). Handle both forms in the helper, or
deleting the workaround is a latent regression rather than a cleanup.

## Three more real bugs found during analysis

All in scope because they sit directly on the code being touched:

1. **You cannot clear an expiry date once set.** Confirmed by reading the handler:
   `handleSubmit` maps `""` → `undefined`, `undefined` drops out of the JSON body,
   `updateItemSchema` is `.nullable().optional()` so an absent key parses to no key, and
   `server/src/routes/items.ts:235-246` spreads `updates` into `.set(updateData)` —
   Drizzle skips `undefined` columns entirely. Clearing is a silent no-op.

   Sending `null` instead works end to end: it survives the schema, fails the
   `instanceof Date` check at `:239`, and reaches `.set({ expirationDate: null })` → SQL NULL.

   Pre-existing (the native input also yields `""` when cleared), but it belongs here —
   the masked control makes `""` a routine transient state on the edit path rather than a
   rare one. Fix: on the edit path send `null`, not `undefined`, when the field is empty.
   The create path can keep `undefined`.

2. **`expirationEstimated` is never set client-side.** The column exists
   (`server/src/db/schema.ts:105`), the route persists it (`server/src/routes/items.ts:78`),
   the schema declares it, seed data uses it — but neither `handlePresetSelect` nor the AI
   suggestion path writes `expirationEstimated: true`. The client silently drops the fact
   on every estimate. Verified: zero occurrences in `AddItemDialog.tsx`.

3. **`handlePresetSelect` clobbers a typed date.** It overwrites `expirationDate`
   unconditionally (`:212-218`). Type a date, then tap a preset, and your date is gone.
   Fix: only overwrite when the field is empty or currently flagged estimated.

   **This interacts with the `DateInput` design and a naive fix only half-works.** The
   guard reads `formData.expirationDate`, but mid-typing that is `""` — indistinguishable
   from genuinely empty. User types `08/16/20`, taps a preset, partial input is destroyed
   and the guard never fires. `DateInput` must expose an in-progress signal: either a
   `dirty` flag lifted to the parent, or `onChange(canonical, { partial: boolean })`.
   Decide this when building the component, not when writing the guard.

## Test plan

**Coverage gate correction:** CLAUDE.md says 80%, but `apps/web/vitest.config.ts:18-23`
enforces **59 statements / 50 branches / 48 functions / 60 lines** — a deliberate baseline
ratchet. Thresholds are project-wide, not per-file, and a branch-dense new component with
thin tests can drag the aggregate under. Budget ~18-22 component tests.

There is **no existing test of the date field at all** — `AddItemDialog.test.tsx` covers
only barcode scanning and product search. So this is net-new coverage, not repair.

### Existing tests that break

| Test                                                                    | What happens                                                                                                                                                                                                                                                              | Fix                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/inventory.spec.ts:71` `page.fill("#expirationDate", "2026-04-15")` | **Silent false negative** — `fill()` still succeeds on a text input, but the mask strips `-` and reads `20260415` as month `20` → invalid → emits `""`. The test stays green while no longer testing expiry, because the assertion at `:76-77` only checks the item name. | `pressSequentially("04152026")`. Add the missing assertions: displayed value `04/15/2026`, and that the expiry renders on the resulting card. Runs under both `chromium` and `Mobile Chrome`. |
| `e2e/a11y.spec.ts:37-53`                                                | Safe under the single-input design; would fail hard under segments.                                                                                                                                                                                                       | No change — but this is the test that vetoes the segmented alternative.                                                                                                                       |
| `e2e/fixtures.ts:35-41`                                                 | Fixture unchanged; only its consumer changes.                                                                                                                                                                                                                             | None                                                                                                                                                                                          |
| `InventoryPage.test.tsx`, `ItemCard.test.tsx`                           | Set `expirationDate: null` only; never touch the input.                                                                                                                                                                                                                   | None                                                                                                                                                                                          |

### New tests — `apps/web/src/test/components/DateInput.test.tsx`

1. Typing `08162026` → emits `"2026-08-16"`; all intermediate emissions are `""`
2. Partial input `0816` → form state `""`, not malformed
3. Backspace with caret just after a `/` deletes the digit, not the separator; caret lands right
4. Paste `"08/16/2026"` → `"2026-08-16"`
5. Paste `"2026-08-16"` → `"2026-08-16"`
6. Invalid month `13` rejected
7. Invalid day `02/31` rejected
8. Leap year `02/29/2024` accepted
9. Non-leap `02/29/2026` rejected
10. Clearing returns to `""`
11. Programmatic value from a preset renders as `08/16/2026` (controlled re-render, distinct from typing)
12. `editItem` with an existing date renders correctly on open
13. Echo-guard: partial typing survives; a later external write still lands
14. `getByLabelText(/expiry date/i)` resolves (catches the axe failure earlier and cheaper)
15. `inputMode="numeric"` present

### New tests — `AddItemDialog.test.tsx` (additions)

These exercise the dialog, not `DateInput`; filing them separately keeps the
branch-coverage budget honest.

16. Incomplete date at submit on the **create** path → payload `expirationDate: undefined`
17. Clearing a date on the **edit** path → payload `expirationDate: null`, and the item's
    date is actually gone afterward. **Fails against current code** — bug 1 above.
18. Typing a partial date then tapping a preset → the partial input is not destroyed (bug 3)
19. Preset selection sets `expirationEstimated: true`; typing then clears it (bug 2)
20. **Evening rollover:** `vi.setSystemTime("2026-08-16T23:30:00-04:00")`, 7-day preset →
    `08/23/2026`, not `08/24`. **Fails against current code** — pre-existing timezone bug.
21. Same under `TZ=Asia/Tokyo` for the mirror direction

### New test — `ItemCard.test.tsx` (addition)

22. `"2026-04-15"` under `TZ=America/New_York` displays April 15, not 14 — guards the
    deletion of the `+ "T00:00:00"` workaround

## Open decisions

These change the mask and parser and are not mine to pick:

**A. Accepted formats.** Packaging prints `08/16/2026`, `08/26`, and `AUG 2026`.

- (i) 8 digits only — simplest, tightest tests
- (ii) 8 digits + 6-digit `MMDDYY`
- (iii) the above + month-only `MMYY` → auto-completes to the **last** day of that month

The UX analysis argues for (iii): month-only is extremely common on food, and defaulting
to the 1st would falsely trigger the 7-day "expiring soon" warning nearly a month early.
The React analysis prefers (i) for a clean fixed-width mask. (iii) is the better product
answer at the cost of ~3 more branches. **Recommend (iii).** Note it should NOT reuse
`expirationEstimated` to mean "month precision" — those are different facts; true
month-precision display would need a schema addition and is out of scope.

**B. Calendar escape hatch.** Keep a small calendar icon inside the field that opens the
native picker via a visually-hidden `<input type="date">` + `.showPicker()`? Costs ~15
lines, preserves the OS picker for browsing and for anyone who prefers it. **Recommend yes**
— the a11y analysis notes no custom control matches the OS picker on mobile.

**C. Optional extras**, each independently droppable:

- Relative quick-chips (`+1wk` / `+1mo` / `+3mo` / `+1yr`) — biggest speed win for items
  with no printed date; chip math relative to _today_, and a chip tap clears the estimated flag
- Live "expires in 3 weeks" hint — cheap, catches a mistyped year. Use the same 7-day
  threshold as `ItemCard.tsx:38-40` or the form and card will disagree
- Past dates: warn, never block. `isExpired` exists because users log already-expired
  items found while cleaning out the pantry
- Field reorder (expiry to position 2, rest behind a "More details" collapsible) — real
  improvement, but scope creep beyond "modify the expiry date"; recommend a separate PR

## Sequence

1. `DateInput.tsx` + pure helpers, with tests (largest, fully isolated). Decide the
   partial-input signal here — bug 3's guard depends on it.
2. Local-time date helper accepting both bare and `T`-suffixed input; fix the two
   `.toISOString()` sites; delete the `+ "T00:00:00"` workaround
3. Swap the call site in `AddItemDialog`
4. Fix the three bugs: clear-sends-`null` on edit, `expirationEstimated`, preset clobber
5. `timezoneId` in playwright config; fix `inventory.spec.ts:71`
6. Optional extras from decision C
