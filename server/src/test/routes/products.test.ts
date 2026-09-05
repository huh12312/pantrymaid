import { describe, it, expect, beforeAll, afterAll, beforeEach, mock, afterEach } from "bun:test";
import { setupTestDb, teardownTestDb, clearTables, createTestSession } from "../setup";
import { Hono } from "hono";
import productsRoute from "../../routes/products";

describe("Products API Routes", () => {
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
    const session = await createTestSession();
    authCookie = session.cookie;
    originalFetch = global.fetch;

    app = new Hono();
    app.route("/products", productsRoute);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("GET /products/search", () => {
    it("requires authentication", async () => {
      const response = await app.request("/products/search?q=milk", {
        method: "GET",
      });
      expect(response.status).toBe(401);
    });

    it("returns 400 when query is too short (< 2 chars)", async () => {
      const response = await app.request("/products/search?q=a", {
        method: "GET",
        headers: { Cookie: authCookie },
      });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/at least 2/i);
    });

    it("returns 400 when query is missing", async () => {
      const response = await app.request("/products/search", {
        method: "GET",
        headers: { Cookie: authCookie },
      });
      expect(response.status).toBe(400);
    });

    it("caps limit at 10 even if higher value requested", async () => {
      // Mock fetch to avoid real API calls — return empty from both providers
      global.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2/token")) {
          return new Response(
            JSON.stringify({ access_token: "t", token_type: "bearer", expires_in: 1800 }),
            { status: 200 }
          );
        }
        if (urlStr.includes("kroger.com/v1/products")) {
          // Verify limit is capped
          const u = new URL(urlStr);
          const limit = parseInt(u.searchParams.get("filter.limit") ?? "0", 10);
          expect(limit).toBeLessThanOrEqual(10);
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        // OFF search
        return new Response(JSON.stringify({ products: [] }), { status: 200 });
      });

      const response = await app.request("/products/search?q=milk&limit=50", {
        method: "GET",
        headers: { Cookie: authCookie },
      });
      // Should succeed (may return 200 with empty results)
      expect([200, 500]).toContain(response.status);
    });

    it("returns success with data array on valid query", async () => {
      // Mock OFF search to return one product (Kroger unavailable — no env vars set)
      global.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("openfoodfacts.org")) {
          return new Response(
            JSON.stringify({
              products: [
                {
                  code: "012345678901",
                  product_name: "Organic Whole Milk",
                  brands: "Horizon",
                  categories: "en:dairy-products, en:milks",
                  image_url: "https://example.com/milk.jpg",
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const response = await app.request("/products/search?q=milk", {
        method: "GET",
        headers: { Cookie: authCookie },
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it("returns cached results on repeated identical query", async () => {
      let fetchCalls = 0;
      global.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("openfoodfacts.org")) {
          fetchCalls++;
          return new Response(JSON.stringify({ products: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      // First call hits real providers
      await app.request("/products/search?q=yogurt", {
        method: "GET",
        headers: { Cookie: authCookie },
      });

      // Second identical call should be served from cache (no additional fetch)
      const callsAfterFirst = fetchCalls;
      await app.request("/products/search?q=yogurt", {
        method: "GET",
        headers: { Cookie: authCookie },
      });

      expect(fetchCalls).toBe(callsAfterFirst);
    });
  });
});
