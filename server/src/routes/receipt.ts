import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware, getUser } from "../middleware/auth";
import { veryfiClient } from "../lib/veryfi";
import { decodeReceiptItems } from "../lib/openai";
import { openFoodFactsClient } from "../lib/openfoodfacts";

const receipt = new Hono();

// Receipt processing requires authentication
receipt.use("*", authMiddleware);

/**
 * POST /receipt - Upload and process receipt
 */
receipt.post(
  "/",
  zValidator("json", z.object({
    imageBase64: z.string().min(1, "Image data is required"),
  })),
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
        return c.json(
          {
            success: false,
            error: "Failed to process receipt image",
          },
          500
        );
      }

      const storeName = veryfiResult.vendor?.name;
      const lineItems = veryfiResult.line_items || [];

      if (lineItems.length === 0) {
        return c.json(
          {
            success: false,
            error: "No items found on receipt",
          },
          400
        );
      }

      // Step 2: Decode abbreviated product names using OpenAI
      let decodedItems;
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
        // Fall back to raw descriptions
        decodedItems = lineItems.map((item) => ({
          raw: item.description,
          decoded: item.description,
          confidence: 0.5,
          quantity: item.quantity,
          price: item.price,
        }));
      }

      // Step 3: Fuzzy match decoded names to Open Food Facts
      const enhancedItems = await Promise.all(
        decodedItems.map(async (item: any) => {
          try {
            // Search Open Food Facts for the decoded name
            const products = await openFoodFactsClient.searchProducts(item.decoded, 1);
            const match = products[0];

            return {
              raw: item.raw || item.decoded,
              decoded: item.decoded,
              confidence: item.confidence,
              quantity: item.quantity,
              price: item.price,
              // Add matched product info if found
              ...(match && {
                matchedProduct: {
                  name: match.product_name,
                  brand: match.brands,
                  category: match.categories,
                  imageUrl: match.image_url,
                },
              }),
            };
          } catch (error) {
            console.error("Error matching product:", error);
            return item;
          }
        })
      );

      // Step 4: Return results for user review
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
          error: "Failed to process receipt",
        },
        500
      );
    }
  }
);

export default receipt;
