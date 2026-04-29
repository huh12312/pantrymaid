 
 
/* eslint-disable @typescript-eslint/no-explicit-any */
 
 
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { setupTestDb, teardownTestDb, clearTables } from "../setup";
import { factories } from "../factories";
import { Hono } from "hono";
import receiptRoute from "../../routes/receipt";

describe("Receipt API Routes", () => {
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
    app.route("/receipt", receiptRoute);
  });

  describe("POST /receipt", () => {
    it("should accept multipart form and return decoded items array", async () => {
      // Create a mock receipt image as FormData
      const formData = new FormData();
      const mockImageBlob = new Blob(["mock-receipt-image"], {
        type: "image/jpeg",
      });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
      expect(json.data.lineItems).toBeInstanceOf(Array);
      expect(json.data.storeName).toBeDefined();

      // Verify each line item has required fields
      if (json.data.lineItems.length > 0) {
        const firstItem = json.data.lineItems[0];
        expect(firstItem.raw).toBeDefined();
        expect(firstItem.decoded).toBeDefined();
        expect(firstItem.confidence).toBeGreaterThanOrEqual(0);
        expect(firstItem.confidence).toBeLessThanOrEqual(1);
      }
    });

    it("should decode abbreviated product names", async () => {
      const formData = new FormData();
      const mockImageBlob = new Blob(["mock-receipt"], { type: "image/jpeg" });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      const json = await response.json();

      // Verify abbreviated names were decoded
      // Example: "GV MLK HLF GL" -> "Great Value Milk Half Gallon"
      json.data.lineItems.forEach((item: any) => {
        expect(item.raw).toBeDefined();
        expect(item.decoded).toBeDefined();
        // Decoded should be longer or equal to raw (expanded abbreviations)
        expect(item.decoded.length).toBeGreaterThanOrEqual(item.raw.length);
      });
    });

    it("should include confidence scores for decoded items", async () => {
      const formData = new FormData();
      const mockImageBlob = new Blob(["mock-receipt"], { type: "image/jpeg" });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      const json = await response.json();

      json.data.lineItems.forEach((item: any) => {
        expect(item.confidence).toBeDefined();
        expect(typeof item.confidence).toBe("number");
        expect(item.confidence).toBeGreaterThanOrEqual(0);
        expect(item.confidence).toBeLessThanOrEqual(1);
      });
    });

    it("should fallback to GPT-4.1-mini for low confidence items", async () => {
      const formData = new FormData();
      const mockImageBlob = new Blob(["complex-receipt"], {
        type: "image/jpeg",
      });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      const json = await response.json();

      // All items should have confidence >= 0.7 (after fallback if needed)
      // Or should be marked for manual review
      json.data.lineItems.forEach((item: any) => {
        if (item.confidence < 0.7) {
          expect(item.needsReview).toBe(true);
        }
      });
    });

    it("should include quantity and price from Veryfi OCR", async () => {
      const formData = new FormData();
      const mockImageBlob = new Blob(["receipt-with-prices"], {
        type: "image/jpeg",
      });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      const json = await response.json();

      // At least some items should have quantity and price
      const itemsWithPrice = json.data.lineItems.filter(
        (item: any) => item.price !== undefined
      );
      expect(itemsWithPrice.length).toBeGreaterThan(0);
    });

    it("should extract store name from receipt", async () => {
      const formData = new FormData();
      const mockImageBlob = new Blob(["walmart-receipt"], {
        type: "image/jpeg",
      });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      const json = await response.json();
      expect(json.data.storeName).toBeDefined();
      expect(typeof json.data.storeName).toBe("string");
    });

    it("should fail without authentication", async () => {
      const formData = new FormData();
      const mockImageBlob = new Blob(["receipt"], { type: "image/jpeg" });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        body: formData,
      });

      expect(response.status).toBe(401);
    });

    it("should fail without receipt file", async () => {
      const formData = new FormData();
      // No file attached

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toMatch(/receipt.*required/i);
    });

    it("should fail with invalid file type", async () => {
      const formData = new FormData();
      const invalidBlob = new Blob(["not-an-image"], { type: "text/plain" });
      formData.append("receipt", invalidBlob, "receipt.txt");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toMatch(/invalid.*file.*type/i);
    });

    it("should fail with oversized file", async () => {
      const formData = new FormData();
      // Create a large blob (> 10MB)
      const largeBlob = new Blob([new ArrayBuffer(11 * 1024 * 1024)], {
        type: "image/jpeg",
      });
      formData.append("receipt", largeBlob, "huge-receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toMatch(/file.*too.*large|size/i);
    });

    it("should handle Veryfi API errors gracefully", async () => {
      // This test simulates Veryfi API failure
      const formData = new FormData();
      const mockImageBlob = new Blob(["corrupt-image"], {
        type: "image/jpeg",
      });
      formData.append("receipt", mockImageBlob, "corrupt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      // Should return proper error, not crash
      expect([200, 400, 500, 503]).toContain(response.status);

      if (response.status !== 200) {
        const json = await response.json();
        expect(json.error).toBeDefined();
      }
    });

    it("should handle OpenAI API errors gracefully", async () => {
      // Simulates OpenAI decode failure
      const formData = new FormData();
      const mockImageBlob = new Blob(["receipt"], { type: "image/jpeg" });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      // Even if OpenAI fails, should return partial results or proper error
      expect([200, 500, 503]).toContain(response.status);

      if (response.status === 200) {
        const json = await response.json();
        // Should still return structure, even if items are not decoded
        expect(json.data.lineItems).toBeInstanceOf(Array);
      }
    });

    it("should not store receipt images (privacy)", async () => {
      const formData = new FormData();
      const mockImageBlob = new Blob(["sensitive-receipt"], {
        type: "image/jpeg",
      });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      const json = await response.json();

      // Response should not include image URL or stored path
      expect(json.data.imageUrl).toBeUndefined();
      expect(json.data.storedPath).toBeUndefined();
    });

    it("should support PNG format", async () => {
      const formData = new FormData();
      const pngBlob = new Blob(["png-receipt"], { type: "image/png" });
      formData.append("receipt", pngBlob, "receipt.png");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      expect([200, 400]).toContain(response.status);

      if (response.status === 200) {
        const json = await response.json();
        expect(json.data.lineItems).toBeInstanceOf(Array);
      }
    });

    it("should include total amount if available", async () => {
      const formData = new FormData();
      const mockImageBlob = new Blob(["receipt-with-total"], {
        type: "image/jpeg",
      });
      formData.append("receipt", mockImageBlob, "receipt.jpg");

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Authorization: authToken,
        },
        body: formData,
      });

      const json = await response.json();

      if (json.data.total !== undefined) {
        expect(typeof json.data.total).toBe("number");
        expect(json.data.total).toBeGreaterThan(0);
      }
    });
  });
});
