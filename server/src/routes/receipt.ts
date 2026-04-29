import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getUser } from "../middleware/auth";
import { veryfiClient, VeryfiError } from "../lib/veryfi";
import { decodeReceiptItems } from "../lib/openai";
import { openFoodFactsClient } from "../lib/openfoodfacts";
import type { DecodedItem } from "../lib/openai";

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

      // Step 1: Process receipt with Veryfi OCR
      let veryfiResult;
      try {
        veryfiResult = await veryfiClient.processReceipt(imageBase64);
      } catch (error) {
        console.error("Veryfi processing error:", error);

        // Specific error handling for Veryfi
        if (error instanceof VeryfiError) {
          if (error.statusCode === 429) {
            return c.json(
              {
                success: false,
                error: "Receipt processing rate limit exceeded. Please try again in a moment.",
              },
              429
            );
          }
          if (error.statusCode === 400) {
            return c.json(
              {
                success: false,
                error: "Invalid receipt image. Please ensure the image is clear and contains a receipt.",
              },
              400
            );
          }
        }

        return c.json(
          {
            success: false,
            error: "Failed to process receipt image. Please try again.",
          },
          502
        );
      }

      const storeName = veryfiResult.vendor?.name;
      const lineItems = veryfiResult.line_items || [];

      if (lineItems.length === 0) {
        return c.json(
          {
            success: false,
            error: "No items found on receipt. Please ensure the receipt is clearly visible.",
          },
          400
        );
      }

      // Step 2: Decode abbreviated product names using OpenAI
      let decodedItems: DecodedItem[];
      try {
        decodedItems = await decodeReceiptItems(
          lineItems.map((item) => ({
            description: item.description,
            qty: item.quantity,
            price: item.price,
          })),
          storeName
        );
      } catch (error) {
        console.error("OpenAI decoding error:", error);
        // Fall back to raw descriptions if OpenAI fails
        decodedItems = lineItems.map((item) => ({
          raw: item.description,
          decoded: item.description,
          confidence: 0.5,
        }));
      }

      // Step 3: Fuzzy match decoded names to Open Food Facts
      const enhancedItems: EnhancedItem[] = await Promise.all(
        decodedItems.map(
          async (item: DecodedItem, index: number): Promise<EnhancedItem> => {
            try {
              // Search Open Food Facts for the decoded name
              const matches = await openFoodFactsClient.fuzzySearch(
                item.decoded
              );
              const bestMatch = matches[0];

              return {
                raw: item.raw,
                decoded: item.decoded,
                confidence: item.confidence,
                quantity: lineItems[index]?.quantity,
                price: lineItems[index]?.price,
                // Add matched product info if found
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
                quantity: lineItems[index]?.quantity,
                price: lineItems[index]?.price,
              };
            }
          }
        )
      );

      // Step 4: Return results for user review
      // Always require user confirmation (never auto-insert)
      const result = {
        storeName,
        lineItems: enhancedItems,
        total: veryfiResult.total,
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
