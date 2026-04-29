 
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { VeryfiClient, VeryfiError } from "../../lib/veryfi";

describe("VeryfiClient", () => {
  let client: VeryfiClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new VeryfiClient({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      username: "test-username",
      apiKey: "test-api-key",
    });

    // Save original fetch
    originalFetch = global.fetch;
  });

  test("should send correct headers and auth", async () => {
    let capturedHeaders: Headers | undefined;

    global.fetch = mock(async (url, options) => {
      capturedHeaders = new Headers(options?.headers);
      return new Response(
        JSON.stringify({
          vendor: { name: "Test Store" },
          line_items: [
            { description: "Test Item", quantity: 1, price: 5.99 },
          ],
          total: 5.99,
        }),
        { status: 200 }
      );
    });

    await client.processReceipt("base64data");

    expect(capturedHeaders?.get("Content-Type")).toBe("application/json");
    expect(capturedHeaders?.get("CLIENT-ID")).toBe("test-client-id");
    expect(capturedHeaders?.get("AUTHORIZATION")).toBe(
      "apikey test-username:test-api-key"
    );

    // Restore
    global.fetch = originalFetch;
  });

  test("should parse response correctly", async () => {
    global.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          vendor: { name: "Walmart" },
          line_items: [
            { description: "GV MLK", quantity: 2, price: 3.99 },
            { description: "BNNNA", quantity: 1, total: 1.29 },
          ],
          total: 9.27,
        }),
        { status: 200 }
      );
    });

    const result = await client.processReceipt("base64data");

    expect(result.vendor?.name).toBe("Walmart");
    expect(result.line_items).toHaveLength(2);
    expect(result.line_items?.[0]?.description).toBe("GV MLK");
    expect(result.line_items?.[0]?.quantity).toBe(2);
    expect(result.line_items?.[1]?.price).toBe(1.29); // Should use total as price fallback
    expect(result.total).toBe(9.27);

    // Restore
    global.fetch = originalFetch;
  });

  test("should retry on 429 with Retry-After header", async () => {
    let attemptCount = 0;

    global.fetch = mock(async () => {
      attemptCount++;

      if (attemptCount === 1) {
        const headers = new Headers();
        headers.set("Retry-After", "1"); // 1 second
        return new Response("Rate limit exceeded", {
          status: 429,
          headers,
        });
      }

      return new Response(
        JSON.stringify({
          vendor: { name: "Store" },
          line_items: [],
          total: 0,
        }),
        { status: 200 }
      );
    });

    const result = await client.processReceipt("base64data");

    expect(attemptCount).toBe(2); // Initial + 1 retry
    expect(result.vendor?.name).toBe("Store");

    // Restore
    global.fetch = originalFetch;
  });

  test("should throw VeryfiError on non-429 error", async () => {
    global.fetch = mock(async () => {
      return new Response("Invalid request", { status: 400 });
    });

    await expect(client.processReceipt("base64data")).rejects.toThrow(
      VeryfiError
    );

    // Restore
    global.fetch = originalFetch;
  });

  test("should throw VeryfiError after max retries on 429", async () => {
    global.fetch = mock(async () => {
      return new Response("Rate limit exceeded", { status: 429 });
    });

    await expect(client.processReceipt("base64data")).rejects.toThrow();

    // Restore
    global.fetch = originalFetch;
  });

  test("should normalize line items with default quantity", async () => {
    global.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          line_items: [
            { description: "Item without qty" },
            { description: "Item with qty", quantity: 3 },
          ],
        }),
        { status: 200 }
      );
    });

    const result = await client.processReceipt("base64data");

    expect(result.line_items?.[0]?.quantity).toBe(1); // Default
    expect(result.line_items?.[1]?.quantity).toBe(3);

    // Restore
    global.fetch = originalFetch;
  });
});
