import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { openFoodFactsClient } from "../lib/openfoodfacts";
import { estimateExpiration } from "../lib/openai";
// import { db } from "../lib/db"; // TODO: Uncomment when DB schema is ready

const barcode = new Hono();

// Barcode lookup requires authentication
barcode.use("*", authMiddleware);

/**
 * GET /barcode/:upc - Look up product by UPC barcode
 */
barcode.get("/:upc", async (c) => {
  try {
    const upc = c.req.param("upc");

    // TODO: Check product_cache first when DB schema is ready
    // const [cached] = await db.select().from(productCacheTable)
    //   .where(eq(productCacheTable.upc, upc));

    // if (cached) {
    //   return c.json({ success: true, data: cached });
    // }

    // Look up in Open Food Facts
    const product = await openFoodFactsClient.getProductByBarcode(upc);

    if (!product) {
      return c.json(
        {
          success: false,
          error: "Product not found",
        },
        404
      );
    }

    // Parse category and estimate expiration
    let expirationEstimate;
    try {
      expirationEstimate = await estimateExpiration(
        product.product_name || "Unknown",
        product.categories
      );
    } catch (error) {
      console.error("Error estimating expiration:", error);
      // Continue without expiration estimate
    }

    const result = {
      upc: product.code,
      name: product.product_name || "Unknown Product",
      brand: product.brands || undefined,
      category: product.categories || undefined,
      imageUrl: product.image_url || undefined,
      estimatedExpirationDays: expirationEstimate?.days,
      estimatedExpirationLabel: expirationEstimate?.label,
    };

    // TODO: Cache the result when DB schema is ready
    // await db.insert(productCacheTable).values({
    //   upc: result.upc,
    //   name: result.name,
    //   brand: result.brand || null,
    //   category: result.category || null,
    //   imageUrl: result.imageUrl || null,
    //   source: "open_food_facts",
    //   fetchedAt: new Date(),
    // }).onConflictDoNothing();

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error looking up barcode:", error);
    return c.json(
      {
        success: false,
        error: "Failed to look up barcode",
      },
      500
    );
  }
});

export default barcode;
