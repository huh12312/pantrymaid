/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { setupTestDb, teardownTestDb, clearTables, testDb, createTestSession } from "../setup";
import { factories } from "../factories";
import { households, users } from "../../db/schema";
import { _deps } from "../../lib/llm";
import { Hono } from "hono";
import receiptRoute from "../../routes/receipt";

// src/test/preload.ts installs a global guard that makes _deps.generateObject throw
// "Real LLM call attempted in test" unless a suite stubs it explicitly (see that
// file's comment, and the save/restore pattern in src/test/integrations/openai.test.ts).
// We save the guard here so every test can restore it in afterEach — leaving a
// "succeeds" stub installed would leak into whichever test file bun loads next in this
// same process.
const guardedGenerateObject = _deps.generateObject;

const CANNED_RECEIPT = {
  storeName: "Walmart Supercenter",
  lineItems: [
    {
      description: "Great Value Whole Milk Half Gallon",
      quantity: 1,
      price: 3.48,
      confidence: 0.95,
    },
    { description: "Bananas", quantity: 6, price: 1.74, confidence: 0.85 },
  ],
  total: 5.22,
};

function stubReceiptParse(returnValue: unknown = CANNED_RECEIPT) {
  _deps.generateObject = mock(async () => ({ object: returnValue })) as typeof _deps.generateObject;
}

describe("Receipt API Routes", () => {
  let app: Hono;
  let authCookie: string;
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTables();

    // receipt.ts 403s any user without a household, so the fixture user needs a real
    // household + `users` row, not just a bare session.
    const testHousehold = factories.household();
    await testDb.insert(households).values(testHousehold);

    const session = await createTestSession();
    const testUser = factories.user(testHousehold.id, {
      id: session.id,
      displayName: session.name,
    });
    await testDb.insert(users).values(testUser);
    authCookie = session.cookie;

    // Happy-path default: parseReceiptImage() succeeds with a realistic receipt. Tests
    // that need different LLM behavior (e.g. the error-handling test) override this.
    stubReceiptParse();

    // Avoid a live network dependency on Open Food Facts for the fuzzy-match step
    // (receipt.ts's per-item matchedProduct enrichment) — return no matches so it
    // degrades the same way it would on a genuine miss.
    originalFetch = global.fetch;
    global.fetch = mock(
      async () => new Response(JSON.stringify({ products: [] }), { status: 200 })
    ) as any;

    app = new Hono();
    app.route("/receipt", receiptRoute);
  });

  afterEach(() => {
    _deps.generateObject = guardedGenerateObject;
    global.fetch = originalFetch;
  });

  describe("POST /receipt", () => {
    it("should accept imageBase64 JSON and return decoded items array", async () => {
      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Cookie: authCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageBase64: "bW9jay1yZWNlaXB0LWltYWdl" }),
      });

      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
      expect(json.data.lineItems).toBeInstanceOf(Array);
      expect(json.data.storeName).toBeDefined();

      if (json.data.lineItems.length > 0) {
        const firstItem = json.data.lineItems[0];
        expect(firstItem.raw).toBeDefined();
        expect(firstItem.decoded).toBeDefined();
        expect(firstItem.confidence).toBeGreaterThanOrEqual(0);
        expect(firstItem.confidence).toBeLessThanOrEqual(1);
      }
    });

    it("should return fully decoded product names", async () => {
      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Cookie: authCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageBase64: "bW9jay1yZWNlaXB0" }),
      });

      const json = await response.json();

      json.data.lineItems.forEach((item: any) => {
        expect(item.raw).toBeDefined();
        expect(item.decoded).toBeDefined();
        expect(item.decoded.length).toBeGreaterThanOrEqual(item.raw.length);
      });
    });

    it("should include confidence scores for decoded items", async () => {
      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Cookie: authCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageBase64: "bW9jay1yZWNlaXB0" }),
      });

      const json = await response.json();

      json.data.lineItems.forEach((item: any) => {
        expect(item.confidence).toBeDefined();
        expect(typeof item.confidence).toBe("number");
        expect(item.confidence).toBeGreaterThanOrEqual(0);
        expect(item.confidence).toBeLessThanOrEqual(1);
      });
    });

    it("should include quantity and price from receipt parsing", async () => {
      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Cookie: authCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageBase64: "cmVjZWlwdC13aXRoLXByaWNlcw==" }),
      });

      const json = await response.json();

      const itemsWithPrice = json.data.lineItems.filter((item: any) => item.price !== undefined);
      expect(itemsWithPrice.length).toBeGreaterThan(0);
    });

    it("should extract store name from receipt", async () => {
      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Cookie: authCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageBase64: "d2FsbWFydC1yZWNlaXB0" }),
      });

      const json = await response.json();
      expect(json.data.storeName).toBeDefined();
      expect(typeof json.data.storeName).toBe("string");
    });

    it("should fail without authentication", async () => {
      const response = await app.request("/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: "dGVzdA==" }),
      });

      expect(response.status).toBe(401);
    });

    it("should fail without imageBase64 field", async () => {
      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Cookie: authCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it("should handle LLM API errors gracefully", async () => {
      // Override the happy-path stub from beforeEach — this test exercises the failure
      // path (parseReceiptImage rejecting), not the "no stub installed" guard-throw.
      _deps.generateObject = mock(async () => {
        throw new Error("simulated LLM vision failure");
      }) as typeof _deps.generateObject;

      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Cookie: authCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageBase64: "Y29ycnVwdC1pbWFnZQ==" }),
      });

      expect([200, 400, 500, 502, 503]).toContain(response.status);

      if (response.status !== 200) {
        const json = await response.json();
        expect(json.error).toBeDefined();
      }
    });

    it("should not store receipt images (privacy)", async () => {
      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Cookie: authCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageBase64: "c2Vuc2l0aXZlLXJlY2VpcHQ=" }),
      });

      const json = await response.json();

      expect(json.data.imageUrl).toBeUndefined();
      expect(json.data.storedPath).toBeUndefined();
    });

    it("should include total amount if available", async () => {
      const response = await app.request("/receipt", {
        method: "POST",
        headers: {
          Cookie: authCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageBase64: "cmVjZWlwdC13aXRoLXRvdGFs" }),
      });

      const json = await response.json();

      if (json.data.total !== undefined) {
        expect(typeof json.data.total).toBe("number");
        expect(json.data.total).toBeGreaterThan(0);
      }
    });
  });
});
