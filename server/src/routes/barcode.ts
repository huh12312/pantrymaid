import { Hono } from "hono";
import { authMiddleware, getUser } from "../middleware/auth";
import { normalizeCategoryFromOff } from "../lib/openfoodfacts";
import { lookupProductChain } from "../lib/providers/chain";
import { estimateExpiration, extractBrandFromName } from "../lib/openai";
import { db } from "../lib/db";
import { households } from "../db/schema";
import { eq } from "drizzle-orm";

const barcode = new Hono();

// Barcode lookup requires authentication
barcode.use("*", authMiddleware);

// Realistic retail barcode symbologies only — UPC-E (8), UPC-A (12), EAN-13 (13),
// ITF-14 (14). Anything else is not a real product barcode and shouldn't trigger a
// (potentially paid, always network) provider lookup.
const VALID_UPC_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * GET /barcode/:upc - Look up product by UPC barcode
 * Uses product_cache layer with 7-day TTL
 */
barcode.get("/:upc", async (c) => {
  try {
    const upc = c.req.param("upc");

    // Validate UPC format: digits only, and a length that matches a real barcode
    // symbology (UPC-E/UPC-A/EAN-13/ITF-14). Reject anything else before doing any
    // lookup — e.g. "123" is all-digits but not a real UPC.
    if (!upc || !/^\d+$/.test(upc) || !VALID_UPC_LENGTHS.has(upc.length)) {
      return c.json(
        {
          success: false,
          error: "Invalid UPC format. Must be a numeric UPC/EAN of 8, 12, 13, or 14 digits.",
        },
        400
      );
    }

    // Resolve the household's Kroger locationId for store-specific pricing
    const user = getUser(c);
    let locationId: string | undefined;
    if (user.householdId) {
      const [household] = await db
        .select({ krogerLocationId: households.krogerLocationId })
        .from(households)
        .where(eq(households.id, user.householdId));
      locationId = household?.krogerLocationId ?? undefined;
    }

    // Look up via provider chain: Kroger → Open Food Facts (with automatic cache layer)
    const product = await lookupProductChain(upc, locationId ? { locationId } : undefined);

    if (!product) {
      return c.json(
        {
          success: false,
          error: "Product not found",
          upc,
        },
        404
      );
    }

    const productName = product.name || "Unknown Product";

    const normalizedCategory = normalizeCategoryFromOff(product.category ?? null);

    // Run expiration estimation and brand extraction in parallel
    const [expirationEstimate, inferredBrand] = await Promise.all([
      estimateExpiration(productName, normalizedCategory || undefined, user.householdId).catch(
        (err) => {
          console.error("Error estimating expiration:", err);
          return null;
        }
      ),
      // Only call brand extraction if OFF didn't supply one
      !product.brand
        ? extractBrandFromName(productName, user.householdId).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Flat fields matching the shared `barcodeProductSchema` contract (not a nested
    // `expiration` object) so the estimate we just paid an LLM call for is actually
    // usable by callers instead of silently discarded.
    const result = {
      upc: product.upc,
      name: productName,
      brand: product.brand || inferredBrand || undefined,
      category: normalizedCategory ?? undefined,
      imageUrl: product.imageUrl || undefined,
      source: product.source,
      estimatedExpirationDays: expirationEstimate?.days ?? undefined,
      estimatedExpirationLabel: expirationEstimate?.label ?? undefined,
    };

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error looking up barcode:", error);
    return c.json(
      {
        success: false,
        error: "Failed to look up barcode. Please try again.",
      },
      500
    );
  }
});

export default barcode;
