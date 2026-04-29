 
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { OpenFoodFactsClient } from "../../lib/openfoodfacts";
import { db } from "../../lib/db";
import { productCache } from "../../db/schema";
import { eq } from "drizzle-orm";

describe("OpenFoodFactsClient", () => {
  let client: OpenFoodFactsClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new OpenFoodFactsClient();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("should fetch product by barcode from API", async () => {
    global.fetch = mock(async (url) => {
      if (typeof url === "string" && url.includes("/product/")) {
        return new Response(
          JSON.stringify({
            status: 1,
            product: {
              code: "123456",
              product_name: "Test Product",
              brands: "Test Brand",
              categories: "Food",
              image_url: "https://example.com/image.jpg",
            },
          }),
          { status: 200 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await client.getProductByBarcode("123456");

    expect(result).not.toBeNull();
    expect(result?.name).toBe("Test Product");
    expect(result?.brand).toBe("Test Brand");
    expect(result?.upc).toBe("123456");
  });

  test("should return null for non-existent product", async () => {
    global.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          status: 0,
        }),
        { status: 200 }
      );
    });

    const result = await client.getProductByBarcode("999999");

    expect(result).toBeNull();
  });

  test("should handle API errors gracefully", async () => {
    global.fetch = mock(async () => {
      return new Response("Server error", { status: 500 });
    });

    const result = await client.getProductByBarcode("123456");

    expect(result).toBeNull();
  });

  test("should search products by name", async () => {
    global.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          products: [
            {
              code: "111",
              product_name: "Milk",
              brands: "Brand A",
            },
            {
              code: "222",
              product_name: "Whole Milk",
              brands: "Brand B",
            },
          ],
        }),
        { status: 200 }
      );
    });

    const results = await client.searchProducts("milk", 10);

    expect(results).toHaveLength(2);
    expect(results[0]?.product_name).toBe("Milk");
    expect(results[1]?.product_name).toBe("Whole Milk");
  });

  test("should return empty array on search error", async () => {
    global.fetch = mock(async () => {
      return new Response("Error", { status: 500 });
    });

    const results = await client.searchProducts("test", 10);

    expect(results).toEqual([]);
  });

  test("should perform fuzzy search with confidence scores", async () => {
    global.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          products: [
            {
              code: "111",
              product_name: "Great Value Milk",
              brands: "Great Value",
            },
            {
              code: "222",
              product_name: "Milk",
              brands: "Generic",
            },
            {
              code: "333",
              product_name: "Soy Milk",
              brands: "Silk",
            },
          ],
        }),
        { status: 200 }
      );
    });

    const matches = await client.fuzzySearch("milk");

    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(3);

    // Results should be sorted by confidence (descending)
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1]!.confidence).toBeGreaterThanOrEqual(
        matches[i]!.confidence
      );
    }

    // All results should have confidence > 0.3
    matches.forEach((match) => {
      expect(match.confidence).toBeGreaterThan(0.3);
    });
  });

  test("should calculate similarity correctly", async () => {
    global.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          products: [
            { code: "1", product_name: "test" },
            { code: "2", product_name: "test product" },
            { code: "3", product_name: "testing" },
          ],
        }),
        { status: 200 }
      );
    });

    const matches = await client.fuzzySearch("test");

    // "test" should have highest confidence (exact match)
    const exactMatch = matches.find((m) => m.product.product_name === "test");
    expect(exactMatch).toBeDefined();
    expect(exactMatch!.confidence).toBeGreaterThan(0.8);
  });

  test("should cache product after fetch", async () => {
    global.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          status: 1,
          product: {
            code: "789",
            product_name: "Cached Product",
            brands: "Cache Brand",
          },
        }),
        { status: 200 }
      );
    });

    // First call should hit API and cache
    const result1 = await client.getProductByBarcode("789");
    expect(result1?.name).toBe("Cached Product");

    // Check cache directly
    const [cached] = await db
      .select()
      .from(productCache)
      .where(eq(productCache.upc, "789"));

    expect(cached).toBeDefined();
    expect(cached?.name).toBe("Cached Product");
    expect(cached?.source).toBe("open_food_facts");

    // Clean up
    await db.delete(productCache).where(eq(productCache.upc, "789"));
  });

  test("should use cached product if fresh", async () => {
    // Insert fresh cache entry
    await db.insert(productCache).values({
      upc: "456",
      name: "Cached Item",
      brand: "Cached Brand",
      category: null,
      imageUrl: null,
      source: "open_food_facts",
      fetchedAt: new Date(), // Fresh
    });

    let fetchCalled = false;
    global.fetch = mock(async () => {
      fetchCalled = true;
      return new Response("Should not be called", { status: 500 });
    });

    const result = await client.getProductByBarcode("456");

    expect(result?.name).toBe("Cached Item");
    expect(fetchCalled).toBe(false); // Should not have called API

    // Clean up
    await db.delete(productCache).where(eq(productCache.upc, "456"));
  });

  test("should re-fetch if cache is stale (>7 days)", async () => {
    // Insert stale cache entry (8 days old)
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 8);

    await db.insert(productCache).values({
      upc: "789",
      name: "Stale Item",
      brand: null,
      category: null,
      imageUrl: null,
      source: "open_food_facts",
      fetchedAt: staleDate,
    });

    global.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          status: 1,
          product: {
            code: "789",
            product_name: "Fresh Item",
            brands: "Fresh Brand",
          },
        }),
        { status: 200 }
      );
    });

    const result = await client.getProductByBarcode("789");

    expect(result?.name).toBe("Fresh Item"); // Should get fresh data

    // Clean up
    await db.delete(productCache).where(eq(productCache.upc, "789"));
  });
});
