/**
 * Feature-detection helpers for the native Shape Detection API
 * (`window.BarcodeDetector`). Chrome on Android ships a hardware-accelerated
 * detector that's markedly more tolerant of imperfect frames than ZXing's JS
 * decoder — but it doesn't exist in Firefox, Safari, or jsdom, so callers
 * must always keep the ZXing path as a fallback (see scanEngine.ts /
 * BarcodeScanner.tsx).
 */

/**
 * Barcode symbologies we actually care about for grocery items. Matched
 * against `BarcodeDetector.getSupportedFormats()` — if the UA's detector
 * doesn't support any of these we treat it as unusable even though the
 * global exists, rather than silently failing to detect anything.
 */
export const GROCERY_BARCODE_FORMATS = ["upc_a", "upc_e", "ean_13", "ean_8"] as const;

export function isBarcodeDetectorApiAvailable(
  target: (Window & typeof globalThis) | undefined
): target is (Window & typeof globalThis) & { BarcodeDetector: typeof BarcodeDetector } {
  return !!target && typeof target.BarcodeDetector === "function";
}

/**
 * Returns the subset of `GROCERY_BARCODE_FORMATS` the UA's detector actually
 * supports. Empty array (never a throw) means "don't use the native path."
 */
export async function getUsableBarcodeFormats(
  getSupportedFormats: () => Promise<string[]>
): Promise<string[]> {
  try {
    const supported = await getSupportedFormats();
    return GROCERY_BARCODE_FORMATS.filter((format) => supported.includes(format));
  } catch {
    return [];
  }
}
