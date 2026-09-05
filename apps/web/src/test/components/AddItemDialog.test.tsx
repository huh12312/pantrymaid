import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import { AddItemDialog } from "@/components/inventory/AddItemDialog";
import type { ProductSearchResult, InventoryItem } from "@/lib/api";
import type { ScannedProduct } from "@/lib/barcodeLookup";

const API_BASE = "http://localhost:3000";

// jsdom has no ResizeObserver. Radix's Checkbox (rendered here whenever
// editItem is set, for the "Mark as opened" control) uses it to size its
// indicator; earlier tests in this file never render the edit-mode form, so
// this gap was never exercised. Stub it rather than touching global setup.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver ??=
  ResizeObserverStub;

// ---------------------------------------------------------------------------
// Minimal wrapper: QueryClientProvider only (no router/theme needed here).
// ---------------------------------------------------------------------------
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderDialog(props: Partial<Parameters<typeof AddItemDialog>[0]> = {}) {
  const queryClient = makeQueryClient();

  const defaults = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    ...props,
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <AddItemDialog {...defaults} />
    </QueryClientProvider>
  );
}

// A minimal ProductSearchResult the search handler returns.
const SEARCH_RESULT: ProductSearchResult = {
  name: "Coca-Cola Classic",
  brand: "Coca-Cola",
  category: "Beverages",
  imageUrl: undefined,
  upc: "049000028911",
  source: "open_food_facts",
  confidence: 0.9,
};

// ---------------------------------------------------------------------------
// Scan button — presence / absence
// ---------------------------------------------------------------------------

describe("AddItemDialog — Scan barcode button", () => {
  it("renders when onScanRequest is provided", () => {
    renderDialog({ onScanRequest: vi.fn() });
    expect(screen.getByRole("button", { name: "Scan barcode" })).toBeInTheDocument();
  });

  it("is absent when onScanRequest is not provided", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: "Scan barcode" })).not.toBeInTheDocument();
  });

  it("calls onScanRequest exactly once when clicked", async () => {
    const onScanRequest = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onScanRequest });

    await user.click(screen.getByRole("button", { name: "Scan barcode" }));

    expect(onScanRequest).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// barcodeNotice banner — role="status" and text
// ---------------------------------------------------------------------------

describe("AddItemDialog — barcodeNotice banner", () => {
  it("renders with role=status when a notice string is provided", () => {
    const notice = "We couldn't find that product in our database.";
    renderDialog({ barcodeNotice: notice });

    const banner = screen.getByRole("status");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(notice);
  });

  it("is absent when barcodeNotice is null", () => {
    renderDialog({ barcodeNotice: null });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is absent when barcodeNotice is undefined", () => {
    renderDialog();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Product-search combobox regression — scan button must not break search
// ---------------------------------------------------------------------------

describe("AddItemDialog — product search with onScanRequest present", () => {
  beforeEach(() => {
    // Add handlers for the two APIs the dialog calls on open / on search.
    server.use(
      // getItems (duplicate-warning check) — already in default handlers but
      // override explicitly so this test stays self-contained.
      http.get(`${API_BASE}/api/items`, () =>
        HttpResponse.json({ success: true, data: { items: [], total: 0, page: 1, pageSize: 50 } })
      ),
      // Product search — no default handler exists for this endpoint.
      http.get(`${API_BASE}/api/products/search`, () =>
        HttpResponse.json({ success: true, data: [SEARCH_RESULT] })
      )
    );
  });

  it("shows search results when typing into the search input alongside the scan button", async () => {
    const user = userEvent.setup();
    renderDialog({ onScanRequest: vi.fn() });

    // The scan button is visible.
    expect(screen.getByRole("button", { name: "Scan barcode" })).toBeInTheDocument();

    // Type into the product-search input (identified by label).
    const searchInput = screen.getByLabelText(/search products/i);
    await user.type(searchInput, "co");

    // Wait for the listbox with results to appear (debounce is 300 ms).
    await waitFor(
      () => {
        expect(
          screen.getByRole("listbox", { name: /product search results/i })
        ).toBeInTheDocument();
      },
      { timeout: 2000 }
    );

    // The mocked result should appear in the list.
    expect(screen.getByRole("option", { name: /coca-cola classic/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Expiry date field — DateInput wiring, preset-clobber guard, estimated
// flag, and the edit-path clear-sends-null fix.
// ---------------------------------------------------------------------------

const EDIT_ITEM: InventoryItem = {
  id: "item-1",
  name: "Milk",
  quantity: 1,
  unit: "unit",
  location: "fridge",
  expirationDate: "2026-04-15",
  expirationEstimated: false,
  householdId: "hh1",
  addedBy: "u1",
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  opened: false,
};

describe("AddItemDialog — expiry date field", () => {
  it("clearing an existing expiry date on the edit path submits expirationDate: null", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSubmit, editItem: EDIT_ITEM });

    const dateInput = screen.getByLabelText(/expiry date/i);
    expect(dateInput).toHaveValue("04/15/2026");

    await user.clear(dateInput);
    expect(dateInput).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /update item/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ expirationDate: null }));
  });

  it("does not clobber a typed-but-unsubmitted date when a preset is selected", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    const dateInput = screen.getByLabelText(/expiry date/i);
    await user.type(dateInput, "08162026");
    expect(dateInput).toHaveValue("08/16/2026");

    await user.click(screen.getByRole("button", { name: /quick add a common item/i }));
    await user.type(screen.getByLabelText(/search common items/i), "Artichoke");
    await user.click(screen.getByRole("button", { name: /artichoke/i }));

    // The typed date survives the preset tap.
    expect(dateInput).toHaveValue("08/16/2026");

    await user.type(screen.getByLabelText(/^name/i), "Test Item");
    await user.click(screen.getByRole("button", { name: /add item/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ expirationDate: "2026-08-16", expirationEstimated: false })
    );
  });

  it("preset selection sets expirationEstimated: true when the field is empty", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.click(screen.getByRole("button", { name: /quick add a common item/i }));
    await user.type(screen.getByLabelText(/search common items/i), "Artichoke");
    await user.click(screen.getByRole("button", { name: /artichoke/i }));

    await user.click(screen.getByRole("button", { name: /add item/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ expirationEstimated: true }));

    onSubmit.mockClear();

    // Typing into the now-estimated field clears the estimated flag again.
    const dateInput = screen.getByLabelText(/expiry date/i);
    await user.clear(dateInput);
    await user.type(dateInput, "01012027");
    await user.click(screen.getByRole("button", { name: /add item/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ expirationDate: "2027-01-01", expirationEstimated: false })
    );
  });

  it("evening rollover: a 7-day preset at 23:30 local time lands 7 days out, not 8", async () => {
    // Fake only Date, not timers — faking setTimeout/setInterval too would
    // hang userEvent's internal scheduling.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 16, 23, 30, 0)); // Aug 16, 2026, 23:30 local
    try {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderDialog({ onSubmit });

      await user.click(screen.getByRole("button", { name: /quick add a common item/i }));
      await user.type(screen.getByLabelText(/search common items/i), "Artichoke");
      await user.click(screen.getByRole("button", { name: /artichoke/i }));
      await user.type(screen.getByLabelText(/^name/i), "Test Item");
      await user.click(screen.getByRole("button", { name: /add item/i }));

      // Artichoke's estimated shelf life is 7 days: Aug 16 + 7 = Aug 23, never Aug 24.
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ expirationDate: "2026-08-23" })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------------
  // Enter-to-submit — the field must never blur, so a resolvable short form
  // (4/6 digits) must still make it into the submitted payload. Regression
  // guard for FIX 1: pressing Enter inside the form triggers implicit
  // submission WITHOUT blurring the focused input, so DateInput's keystroke
  // path (which deliberately defers 4/6-digit resolution to blur) never gets
  // the chance to resolve on its own — handleSubmit must force it via
  // dateInputRef.current.resolvePending().
  // -------------------------------------------------------------------------

  it("Enter-to-submit on the create path resolves a pending 4-digit short form instead of dropping it", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.type(screen.getByLabelText(/^name/i), "Cheese");
    const dateInput = screen.getByLabelText(/expiry date/i);
    // Typing "{Enter}" as part of the same user.type call never blurs the
    // input first — the keystroke path leaves "0826" unresolved ("").
    await user.type(dateInput, "0826{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Aug 2026, auto-completed to the last day of the month.
    expect(onSubmit.mock.calls[0]![0].expirationDate).toBe("2026-08-31");
  });

  it("Enter-to-submit on the edit path resolves a pending short form instead of sending null", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSubmit, editItem: EDIT_ITEM });

    const dateInput = screen.getByLabelText(/expiry date/i);
    expect(dateInput).toHaveValue("04/15/2026");

    await user.clear(dateInput);
    await user.type(dateInput, "0826{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Must be the resolved date, not null (which would wipe the existing
    // expiry) and not undefined (dropped from the JSON body / no-op).
    expect(onSubmit.mock.calls[0]![0].expirationDate).toBe("2026-08-31");
  });

  it("blocks submit on the create path when the date is incomplete text that cannot resolve", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.type(screen.getByLabelText(/^name/i), "Cheese");
    const dateInput = screen.getByLabelText(/expiry date/i);
    // "081" never resolves at any digit count — always incomplete.
    await user.type(dateInput, "081");

    await user.click(screen.getByRole("button", { name: /add item/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a complete date");
  });

  it("create path with an empty date field submits with expirationDate: undefined", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    await user.type(screen.getByLabelText(/^name/i), "Cheese");
    await user.click(screen.getByRole("button", { name: /add item/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].expirationDate).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // expiryPartialRef coverage — the existing "does not clobber" test above
  // types all 8 digits, which resolves to a non-empty canonical value, so
  // the guard passes even with `expiryPartialRef` removed entirely. This
  // test types digits that NEVER resolve (canonical stays "" through blur,
  // not just mid-keystroke), so it fails against a naive
  // `!prev.expirationDate` guard that only checks the (still-"") canonical
  // value and would treat the field as empty.
  // -------------------------------------------------------------------------

  it("does not clobber a genuinely unresolved partial date when a preset is selected", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSubmit });

    const dateInput = screen.getByLabelText(/expiry date/i);
    // "081" is 3 digits — digitsToCanonical never resolves 3-digit input,
    // on keystroke OR on blur, so this stays partial no matter what focus
    // changes happen next.
    await user.type(dateInput, "081");
    expect(dateInput).toHaveValue("08/1");

    await user.click(screen.getByRole("button", { name: /quick add a common item/i }));
    await user.type(screen.getByLabelText(/search common items/i), "Artichoke");
    await user.click(screen.getByRole("button", { name: /artichoke/i }));

    // The typed digits survive the preset tap — untouched.
    expect(dateInput).toHaveValue("08/1");

    await user.type(screen.getByLabelText(/^name/i), "Test Item");
    await user.click(screen.getByRole("button", { name: /add item/i }));

    // Still unresolved at submit time — blocked, not silently sent as the
    // preset's estimate.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a complete date");
  });

  it("a second preset selection overwrites the first preset's estimate", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0)); // Jan 1, 2026, noon local
    try {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      renderDialog({ onSubmit });

      const dateInput = screen.getByLabelText(/expiry date/i);

      await user.click(screen.getByRole("button", { name: /quick add a common item/i }));
      // Artichoke: estimatedShelfDays 7 -> Jan 8, 2026.
      await user.type(screen.getByLabelText(/search common items/i), "Artichoke");
      await user.click(screen.getByRole("button", { name: /artichoke/i }));
      expect(dateInput).toHaveValue("01/08/2026");

      // Avocado: estimatedShelfDays 5 -> Jan 6, 2026. Since the field still
      // holds a prior system estimate (expirationEstimated: true), the
      // second preset must overwrite it rather than leaving Artichoke's date.
      await user.type(screen.getByLabelText(/search common items/i), "Avocado");
      await user.click(screen.getByRole("button", { name: /avocado/i }));
      expect(dateInput).toHaveValue("01/06/2026");

      await user.type(screen.getByLabelText(/^name/i), "Test Item");
      await user.click(screen.getByRole("button", { name: /add item/i }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ expirationDate: "2026-01-06", expirationEstimated: true })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Barcode-scan expiry estimate — threading estimatedExpirationDays/Label from
// ScannedProduct into the same estimateDatePatch guard presets/AI-suggestion
// already use.
// ---------------------------------------------------------------------------

describe("AddItemDialog — barcode scan expiry estimate", () => {
  const SCANNED_WITH_ESTIMATE: ScannedProduct = {
    name: "Fresh Milk",
    brand: "Acme Dairy",
    barcode: "012345678901",
    estimatedExpirationDays: 7,
    estimatedExpirationLabel: "~1 week",
  };

  const SCANNED_NO_ESTIMATE: ScannedProduct = {
    name: "Canned Beans",
    barcode: "099999999999",
  };

  const SCANNED_WITH_SHORTER_ESTIMATE: ScannedProduct = {
    name: "Fresh Milk",
    brand: "Acme Dairy",
    barcode: "012345678902",
    estimatedExpirationDays: 3,
    estimatedExpirationLabel: "~3 days",
  };

  function renderScan(scannedProduct: ScannedProduct | null | undefined, onSubmit = vi.fn()) {
    const queryClient = makeQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <AddItemDialog
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          scannedProduct={scannedProduct}
        />
      </QueryClientProvider>
    );
    const rerenderWith = (next: ScannedProduct | null | undefined) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <AddItemDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} scannedProduct={next} />
        </QueryClientProvider>
      );
    return { ...view, rerenderWith, onSubmit };
  }

  it("pre-fills the expiry date and marks it estimated when the scan includes an estimate", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0)); // Jan 1, 2026, noon local
    try {
      const user = userEvent.setup();
      const { onSubmit } = renderScan(SCANNED_WITH_ESTIMATE);

      const dateInput = screen.getByLabelText(/expiry date/i);
      // 7 days out from Jan 1, 2026 -> Jan 8, 2026.
      expect(dateInput).toHaveValue("01/08/2026");
      expect(
        screen.getByText(/estimated ~1 week based on the scanned product/i)
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /add item/i }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ expirationDate: "2026-01-08", expirationEstimated: true })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a no-op when the scan response omits the estimate fields", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderScan(SCANNED_NO_ESTIMATE);

    const dateInput = screen.getByLabelText(/expiry date/i);
    expect(dateInput).toHaveValue("");
    expect(
      screen.queryByText(/estimated .* based on the scanned product/i)
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^name/i), "Canned Beans");
    await user.click(screen.getByRole("button", { name: /add item/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].expirationDate).toBeUndefined();
    expect(onSubmit.mock.calls[0]![0].expirationEstimated).toBe(false);
  });

  it("does not overwrite a date the user already typed before the scan estimate arrives", async () => {
    const user = userEvent.setup();
    // No scannedProduct yet — mirrors a manually-opened dialog where the user
    // types a date, then taps the in-dialog scan button; scannedProduct only
    // arrives afterwards, without the dialog ever closing.
    const { rerenderWith, onSubmit } = renderScan(undefined);

    const dateInput = screen.getByLabelText(/expiry date/i);
    await user.type(dateInput, "06152026");
    expect(dateInput).toHaveValue("06/15/2026");

    rerenderWith(SCANNED_WITH_ESTIMATE);

    // The user's own typed date survives — not clobbered by the scan estimate.
    expect(dateInput).toHaveValue("06/15/2026");
    expect(
      screen.queryByText(/estimated .* based on the scanned product/i)
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^name/i), "Test Item");
    await user.click(screen.getByRole("button", { name: /add item/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ expirationDate: "2026-06-15", expirationEstimated: false })
    );
  });

  it("a newer scan's estimate overwrites a prior scan-derived estimate", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0)); // Jan 1, 2026, noon local
    try {
      const { rerenderWith, onSubmit } = renderScan(SCANNED_WITH_ESTIMATE);
      const user = userEvent.setup();

      const dateInput = screen.getByLabelText(/expiry date/i);
      expect(dateInput).toHaveValue("01/08/2026");

      // A second scan (different product/barcode) with a shorter estimate — the
      // field still holds a prior SYSTEM estimate, so it's replaced, same as a
      // second preset selection replaces the first.
      rerenderWith(SCANNED_WITH_SHORTER_ESTIMATE);

      expect(dateInput).toHaveValue("01/04/2026");
      expect(
        screen.getByText(/estimated ~3 days based on the scanned product/i)
      ).toBeInTheDocument();

      await user.type(screen.getByLabelText(/^name/i), "Test Item");
      await user.click(screen.getByRole("button", { name: /add item/i }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ expirationDate: "2026-01-04", expirationEstimated: true })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
