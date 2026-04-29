 
 
 
 
 
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { setupTestDb, teardownTestDb, clearTables, testDb } from "../setup";
import { factories } from "../factories";
import { productCache } from "../../db/schema";
import { Hono } from "hono";
import barcodeRoute from "../../routes/barcode";

describe("Barcode API Routes", () => {
  let app: Hono;
  let authToken: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTables();

    // Mock auth token
    const testUserId = factories.user("temp-id").id;
    authToken = `Bearer mock-token-${testUserId}`;

    // Setup app with routes
    app = new Hono();
    app.route("/barcode", barcodeRoute);
  });

  describe("GET /barcode/:upc", () => {
    it("should return product from cache if exists", async () => {
      // Pre-populate cache with a product
      const cachedProduct = factories.productCache({
        upc: "012345678901",
        name: "Great Value Milk",
        brand: "Great Value",
        category: "Dairy",
        imageUrl: "https://example.com/milk.jpg",
        source: "open_food_facts",
      });

      await testDb.insert(productCache).values(cachedProduct);

      const response = await app.request("/barcode/012345678901", {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.upc).toBe("012345678901");
      expect(json.data.name).toBe("Great Value Milk");
      expect(json.data.brand).toBe("Great Value");
      expect(json.data.category).toBe("Dairy");
      expect(json.data.imageUrl).toBe("https://example.com/milk.jpg");
      expect(json.data.source).toBe("cache");
    });

    it("should fetch from Open Food Facts if not in cache", async () => {
      // UPC not in cache
      const upc = "041220867820"; // Real Coca-Cola UPC

      const response = await app.request(`/barcode/${upc}`, {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.upc).toBe(upc);
      expect(json.data.name).toBeDefined();
      expect(json.data.source).toBe("open_food_facts");

      // Verify product was cached
      const [cached] = await testDb
        .select()
        .from(productCache)
        .where((t) => t.upc === upc);

      expect(cached).toBeDefined();
      expect(cached.upc).toBe(upc);
      expect(cached.source).toBe("open_food_facts");
    });

    it("should return 404 for unknown barcode", async () => {
      // Fake UPC that doesn't exist
      const fakeUpc = "999999999999";

      const response = await app.request(`/barcode/${fakeUpc}`, {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(404);

      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/not found/i);
    });

    it("should include expiration estimate in response", async () => {
      const cachedProduct = factories.productCache({
        upc: "111111111111",
        name: "Fresh Bread",
        category: "Bakery",
      });

      await testDb.insert(productCache).values(cachedProduct);

      const response = await app.request("/barcode/111111111111", {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.data.estimatedExpirationDays).toBeDefined();
      expect(json.data.estimatedExpirationLabel).toBeDefined();
      expect(typeof json.data.estimatedExpirationDays).toBe("number");
      expect(json.data.estimatedExpirationDays).toBeGreaterThan(0);
    });

    it("should fail without authentication", async () => {
      const response = await app.request("/barcode/012345678901", {
        method: "GET",
      });

      expect(response.status).toBe(401);
    });

    it("should validate UPC format", async () => {
      // Invalid UPC (too short)
      const response = await app.request("/barcode/123", {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toMatch(/invalid.*upc/i);
    });

    it("should handle rate limiting gracefully", async () => {
      // This test verifies the API handles Open Food Facts rate limits
      // In real implementation, this would test retry logic

      const upc = "987654321098";

      const response = await app.request(`/barcode/${upc}`, {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      // Should either succeed or return a proper error
      expect([200, 404, 429, 503]).toContain(response.status);

      if (response.status === 429) {
        const json = await response.json();
        expect(json.error).toMatch(/rate limit|try again/i);
      }
    });

    it("should normalize UPC codes (remove leading zeros)", async () => {
      // Some scanners include leading zeros
      const cachedProduct = factories.productCache({
        upc: "12345678901", // 11 digits
      });

      await testDb.insert(productCache).values(cachedProduct);

      // Request with leading zero
      const response = await app.request("/barcode/012345678901", {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      // Should find the product despite format difference
      expect(json.data).toBeDefined();
    });

    it("should support EAN-13 barcodes (13 digits)", async () => {
      const ean13Product = factories.productCache({
        upc: "5060292302201", // 13-digit EAN
        name: "European Product",
      });

      await testDb.insert(productCache).values(ean13Product);

      const response = await app.request("/barcode/5060292302201", {
        method: "GET",
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.data.name).toBe("European Product");
    });
  });
});
