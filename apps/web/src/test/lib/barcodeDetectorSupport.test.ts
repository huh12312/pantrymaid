import { describe, it, expect } from "vitest";
import {
  isBarcodeDetectorApiAvailable,
  getUsableBarcodeFormats,
  GROCERY_BARCODE_FORMATS,
} from "@/lib/barcodeDetectorSupport";

describe("isBarcodeDetectorApiAvailable", () => {
  it("false when window is undefined (e.g. SSR, or being defensive)", () => {
    expect(isBarcodeDetectorApiAvailable(undefined)).toBe(false);
  });

  it("false when BarcodeDetector isn't on window at all — Firefox/Safari/jsdom", () => {
    const fakeWindow = {} as Window & typeof globalThis;
    expect(isBarcodeDetectorApiAvailable(fakeWindow)).toBe(false);
  });

  it("false when BarcodeDetector exists but isn't a constructor function", () => {
    const fakeWindow = { BarcodeDetector: "not a function" } as unknown as Window &
      typeof globalThis;
    expect(isBarcodeDetectorApiAvailable(fakeWindow)).toBe(false);
  });

  it("true when BarcodeDetector is a function — Chrome/Chromium", () => {
    const fakeWindow = {
      BarcodeDetector: class {},
    } as unknown as Window & typeof globalThis;
    expect(isBarcodeDetectorApiAvailable(fakeWindow)).toBe(true);
  });
});

describe("getUsableBarcodeFormats", () => {
  it("returns the intersection of supported formats and our grocery symbologies", async () => {
    const formats = await getUsableBarcodeFormats(() =>
      Promise.resolve(["qr_code", "ean_13", "upc_a", "aztec"])
    );
    expect(formats.sort()).toEqual(["ean_13", "upc_a"]);
  });

  it("returns an empty array when the UA supports none of our grocery symbologies", async () => {
    const formats = await getUsableBarcodeFormats(() => Promise.resolve(["qr_code", "aztec"]));
    expect(formats).toEqual([]);
  });

  it("returns an empty array (never throws) when getSupportedFormats rejects", async () => {
    const formats = await getUsableBarcodeFormats(() => Promise.reject(new Error("boom")));
    expect(formats).toEqual([]);
  });

  it("GROCERY_BARCODE_FORMATS covers the common grocery symbologies", () => {
    expect(GROCERY_BARCODE_FORMATS).toEqual(["upc_a", "upc_e", "ean_13", "ean_8"]);
  });
});
