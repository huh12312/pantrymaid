import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the entire @/lib/api module so lookupBarcodeToProduct's error handling
// can be tested independently of the HTTP layer.  Direct mocking lets us
// control the exact error message each branch sees — notably the real
// not-found message "Product not found", which carries no status code.
vi.mock("@/lib/api", () => ({
  api: {
    lookupBarcode: vi.fn(),
  },
}));

import { lookupBarcodeToProduct } from "@/lib/barcodeLookup";
import { api } from "@/lib/api";

const mockLookupBarcode = vi.mocked(api.lookupBarcode);

describe("lookupBarcodeToProduct", () => {
  const BARCODE = "012345678901";

  beforeEach(() => {
    mockLookupBarcode.mockReset();
  });

  it("success — returns product fields and notice=null", async () => {
    mockLookupBarcode.mockResolvedValueOnce({
      upc: BARCODE,
      name: "Coca-Cola Classic",
      brand: "Coca-Cola",
      category: "Beverages",
      imageUrl: "https://example.com/coke.jpg",
    });

    const result = await lookupBarcodeToProduct(BARCODE);

    expect(result.notice).toBeNull();
    expect(result.scannedProduct).toEqual({
      name: "Coca-Cola Classic",
      brand: "Coca-Cola",
      category: "Beverages",
      imageUrl: "https://example.com/coke.jpg",
      barcode: BARCODE,
      estimatedExpirationDays: undefined,
      estimatedExpirationLabel: undefined,
    });
  });

  it("success with an expiration estimate — forwards estimatedExpirationDays/Label", async () => {
    mockLookupBarcode.mockResolvedValueOnce({
      upc: BARCODE,
      name: "Coca-Cola Classic",
      brand: "Coca-Cola",
      category: "Beverages",
      imageUrl: "https://example.com/coke.jpg",
      estimatedExpirationDays: 7,
      estimatedExpirationLabel: "~1 week",
    });

    const result = await lookupBarcodeToProduct(BARCODE);

    expect(result.notice).toBeNull();
    expect(result.scannedProduct).toEqual({
      name: "Coca-Cola Classic",
      brand: "Coca-Cola",
      category: "Beverages",
      imageUrl: "https://example.com/coke.jpg",
      barcode: BARCODE,
      estimatedExpirationDays: 7,
      estimatedExpirationLabel: "~1 week",
    });
  });

  // The server returns { error: "Product not found" } with HTTP 404, and the
  // API client throws that text verbatim (no status code in the message).
  it("not-found error — returns empty name, the barcode, and the not-found notice", async () => {
    mockLookupBarcode.mockRejectedValueOnce(new Error("Product not found"));

    const result = await lookupBarcodeToProduct(BARCODE);

    expect(result.scannedProduct).toEqual({ name: "", barcode: BARCODE });
    expect(result.notice).toBe(
      "We couldn't find that product in our database. No worries — just fill in the details below!"
    );
  });

  it('fallback "Request failed (404)" message also maps to the not-found notice', async () => {
    mockLookupBarcode.mockRejectedValueOnce(new Error("Request failed (404)"));

    const result = await lookupBarcodeToProduct(BARCODE);

    expect(result.notice).toBe(
      "We couldn't find that product in our database. No worries — just fill in the details below!"
    );
  });

  it("generic error — returns the fallback manual-entry notice", async () => {
    mockLookupBarcode.mockRejectedValueOnce(new Error("Network error"));

    const result = await lookupBarcodeToProduct(BARCODE);

    expect(result.scannedProduct).toEqual({ name: "", barcode: BARCODE });
    expect(result.notice).toBe(
      "Something went wrong looking up that barcode. You can still add the item manually."
    );
  });

  it("non-Error rejection — falls back to generic notice (not 404)", async () => {
    mockLookupBarcode.mockRejectedValueOnce("unexpected string rejection");

    const result = await lookupBarcodeToProduct(BARCODE);

    expect(result.notice).toBe(
      "Something went wrong looking up that barcode. You can still add the item manually."
    );
  });
});
