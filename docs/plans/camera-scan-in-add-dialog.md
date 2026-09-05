---
title: Add camera barcode-scan option to the "+" add flow
status: planning
created: 2026-06-21
area: apps/web
tags: [feature, frontend, barcode-scanner]
---

# Add camera barcode-scan option to the "+" add flow

## Goal

When the user opens the Add-Item dialog (via the `+` FAB / mobile top-bar), give them a
**camera scan** affordance _right next to the "Search products" box_. Tapping it opens the
existing scanner; a successful scan looks up the barcode and pre-fills the same Add form.

## Key finding

Almost everything already exists. `BarcodeScanner` is fully built, and the
lookup → prefill pipeline already works for the separate top-bar "Scan" button:

```
InventoryPage.handleBarcodeScan  →  api.lookupBarcode  →  scannedProduct prop  →  prefill useEffect
```

This feature is mostly **wiring a second entry point into that proven path** — not new machinery.

## Architecture decision (the one real choice)

**Option B — callback reuses the existing parent flow.** The Camera button calls an
`onScanRequest` prop; the parent closes the dialog, opens the existing scanner, and the existing
`handleBarcodeScan` reopens the dialog pre-filled.

### Why B over nesting the scanner inside the dialog (Option A)

- B adds ~3 things (one prop, one button, one parent wiring line) and reuses the already-tested
  path. A adds all that **plus** nested Radix sheets, local scanner state, merge logic, notice
  syncing, and Escape guards.
- A's own analysis ended with "verify Radix Escape handling at runtime" — a caveat B doesn't carry.
- Mobile is the primary platform; two `side="bottom"` sheets stacked is awkward there, and the UI
  designer (whose domain this is) recommended against nesting.
- A's main advantage (preserving in-progress edits via merge) is moot: the dominant flow is
  scan-_first_, and the current top-bar flow already does a wholesale prefill — so B is
  _consistent_, not a regression. A is a documented future upgrade if edit-preservation is requested.

## Files to change

### 1. `apps/web/src/lib/barcodeLookup.ts` _(new — both experts agreed regardless of A/B)_

- Export the canonical `ScannedProduct` interface (currently duplicated inline in
  `AddItemDialog.tsx:24-30` and `InventoryPage.tsx:66-72`).
- Export `lookupBarcodeToProduct(barcode): Promise<{ scannedProduct, notice }>` — move the
  try/catch + 404 messaging out of `InventoryPage.handleBarcodeScan:192-211`.

### 2. `apps/web/src/pages/InventoryPage.tsx`

- Import the helper + `ScannedProduct`; drop the inline type.
- Refactor `handleBarcodeScan` (186-215) to call `lookupBarcodeToProduct`.
- **Fix the location quirk:** don't hardcode `setDefaultLocation("pantry")` — preserve the
  location the dialog was opened with, so a scan into "Fridge" stays "Fridge".
- Pass `onScanRequest={() => { setAddDialogOpen(false); setScannerOpen(true); }}` to
  `<AddItemDialog>`. (Scanner success already reopens the dialog via `handleBarcodeScan`.)

### 3. `apps/web/src/components/inventory/AddItemDialog.tsx`

- Add optional `onScanRequest?: () => void` to props; import `ScannedProduct` from the new helper.
- Restructure the search row (262-327) into a `flex gap-2`: input column (`relative flex-1`,
  listbox stays inside) + a Camera button:
  ```tsx
  <Button
    type="button"
    variant="outline"
    size="icon"
    className="h-11 w-11 sm:h-10 sm:w-10 shrink-0"
    aria-label="Scan barcode"
    onClick={onScanRequest}
  >
    <Camera className="h-5 w-5" aria-hidden="true" />
  </Button>
  ```
- Bump the input to `h-11 sm:h-10` so heights align; render the button only when `onScanRequest`
  is provided.
- Add `aria-live="polite"` / `role="status"` to the existing `barcodeNotice` banner (240-243) so
  the not-found message is announced on return from the scanner.
- Capture a ref to the Camera button and restore focus to it when the dialog reopens after a scan.

## Accessibility & camera-failure handling (QA expert, pruned to Option B)

- Camera button: `aria-label="Scan barcode"`, ≥44px target (`h-11` on mobile), keyboard-activatable,
  in natural Tab order after the search combobox — must not disturb existing combobox keyboard nav.
- `aria-live="polite"` on the notice banner for both the success-implied and 404 paths.
- Confirm the scanner already degrades gracefully for **denied permission / no camera / non-HTTPS**
  ("Camera unavailable — use manual entry") and that the message is announced; manual-entry input
  stays usable as the fallback.
- _Reconciled out:_ the QA plan's "two nested sheets fighting for focus / focus-trap release" tests
  **do not apply** to Option B — only one dialog is ever open at a time.

## Test plan

- **Unit (Vitest):** Camera button renders with correct label/size; clicking it fires
  `onScanRequest`; combobox search/keyboard nav still works with the button present (regression);
  notice banner has `aria-live`; focus returns to the button when the dialog reopens.
- **Helper test:** `lookupBarcodeToProduct` returns product on success and the right notice string
  on 404 vs generic error.
- **E2E (Playwright):** Camera button visible in the add dialog and opens the scanner sheet; since
  the camera can't run in CI, exercise the **manual-entry path** in the scanner → assert the form
  pre-fills and the item saves. Keep existing `e2e/barcode.spec.ts` and axe scans green.

## Known quirks documented (neither blocks)

1. Location threading — fixed in this plan (file change #2).
2. Brief dialog close → reopen on scan — acceptable; matches current top-bar behavior, and the
   `!open` cleanup (`AddItemDialog.tsx:143-149`) makes the reopen clean.

## Out of scope

- Server / `/api/barcode` changes (unchanged).
- The zxing scanner internals (reused as-is).
- In-place merge-prefill that keeps the dialog open (future enhancement = Option A, if requested).

## Expert contributions

- **voltagent-lang:react-specialist** — state/component wiring, Radix sheet-stacking analysis,
  the `lookupBarcodeToProduct` helper extraction.
- **voltagent-core-dev:ui-designer** — Camera-button placement, variant/size/icon, mobile
  ergonomics, recommended the callback (non-nested) approach.
- **voltagent-qa-sec:accessibility-tester** — a11y requirements, camera-permission failure UX,
  Vitest + Playwright test plan.
- **advisor (reviewer model)** — broke the A/B tie in favor of B; flagged the location quirk and
  pruned the nested-sheet focus tests.
