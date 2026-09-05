import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getUser } from "../middleware/auth";
import { parseReceiptImage } from "../lib/openai";
import { openFoodFactsClient } from "../lib/openfoodfacts";

/**
 * Enhanced item with matched product info
 */
interface EnhancedItem {
  raw: string;
  decoded: string;
  confidence: number;
  quantity?: number;
  price?: number;
  matchedProduct?: {
    name?: string;
    brand?: string;
    category?: string;
    imageUrl?: string;
  };
}

const receipt = new Hono();

// Receipt processing requires authentication
receipt.use("*", authMiddleware);

/**
 * POST /receipt - Upload and process receipt
 */
receipt.post(
  "/",
  zValidator(
    "json",
    z.object({
      imageBase64: z.string().min(1, "Image data is required"),
    })
  ),
  async (c) => {
    try {
      const user = getUser(c);
      const { imageBase64 } = c.req.valid("json");

      if (!user.householdId) {
        return c.json(
          {
            success: false,
            error: "User must belong to a household to process receipts",
          },
          403
        );
      }

      // Step 1: Parse receipt image with LLM vision (OCR + name decoding in one pass)
      let receiptData;
      try {
        receiptData = await parseReceiptImage(imageBase64, user.householdId);
      } catch (error) {
        console.error("Receipt parsing error:", error);
        return c.json(
          {
            success: false,
            error: "Failed to parse receipt image. Please try again.",
          },
          502
        );
      }

      const storeName = receiptData.storeName ?? undefined;
      const parsedItems = receiptData.lineItems;

      if (parsedItems.length === 0) {
        return c.json(
          {
            success: false,
            error: "No items found on receipt. Please ensure the receipt is clearly visible.",
          },
          400
        );
      }

      const decodedItems = parsedItems.map((item) => ({
        raw: item.description,
        decoded: item.description,
        confidence: item.confidence,
        quantity: item.quantity,
        price: item.price ?? undefined,
      }));

      // Step 2: Fuzzy match decoded names to Open Food Facts (adds image, brand, category)
      const enhancedItems: EnhancedItem[] = await Promise.all(
        decodedItems.map(async (item, index): Promise<EnhancedItem> => {
          try {
            const matches = await openFoodFactsClient.fuzzySearch(item.decoded);
            const bestMatch = matches[0];

            return {
              raw: item.raw,
              decoded: item.decoded,
              confidence: item.confidence,
              quantity: decodedItems[index]?.quantity,
              price: decodedItems[index]?.price,
              ...(bestMatch && {
                matchedProduct: {
                  name: bestMatch.product.product_name,
                  brand: bestMatch.product.brands,
                  category: bestMatch.product.categories,
                  imageUrl: bestMatch.product.image_url,
                },
              }),
            };
          } catch (error) {
            console.error("Error matching product:", error);
            return {
              raw: item.raw,
              decoded: item.decoded,
              confidence: item.confidence,
              quantity: decodedItems[index]?.quantity,
              price: decodedItems[index]?.price,
            };
          }
        })
      );

      // Step 3: Return results for user review (never auto-insert)
      const result = {
        storeName,
        lineItems: enhancedItems,
        total: receiptData.total ?? undefined,
      };

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error processing receipt:", error);
      return c.json(
        {
          success: false,
          error: "Failed to process receipt. Please try again.",
        },
        500
      );
    }
  }
);

export default receipt;
