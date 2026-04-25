/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  decodeReceiptItems,
  estimateExpiration,
  clearExpirationCache,
} from "../../lib/openai";
import { _deps } from "../../lib/llm";

const originalGenerateObject = _deps.generateObject;

function stubGenerateObject(returnValue: unknown) {
  _deps.generateObject = mock(async () => ({ object: returnValue })) as any;
}

afterEach(() => {
  _deps.generateObject = originalGenerateObject;
  clearExpirationCache();
});

describe("decodeReceiptItems", () => {
  test("decodes receipt items", async () => {
    stubGenerateObject({
      items: [
        { raw: "GV MLK", decoded: "Great Value Milk", confidence: 0.95 },
        { raw: "BNNNA", decoded: "Banana", confidence: 0.85 },
      ],
    });

    const result = await decodeReceiptItems([
      { description: "GV MLK", qty: 1, price: 3.99 },
      { description: "BNNNA", qty: 6, price: 1.29 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.decoded).toBe("Great Value Milk");
    expect(result[0]?.confidence).toBe(0.95);
    expect(result[1]?.decoded).toBe("Banana");
  });

  test("includes store name in prompt", async () => {
    let capturedMessages: any[] = [];
    _deps.generateObject = mock(async (params: any) => {
      capturedMessages = params.messages;
      return { object: { items: [{ raw: "T", decoded: "Test", confidence: 0.8 }] } };
    }) as any;

    await decodeReceiptItems([{ description: "T" }], "Walmart");
    expect(capturedMessages.some((m: any) => m.content?.includes("Walmart"))).toBe(true);
  });

  test("retries low-confidence items", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount++;
      const decoded = callCount === 1 ? "Unknown Item" : "Better Guess";
      const confidence = callCount === 1 ? 0.5 : 0.75;
      return { object: { items: [{ raw: "OBSCURE", decoded, confidence }] } };
    }) as any;

    const result = await decodeReceiptItems([{ description: "OBSCURE" }]);
    expect(callCount).toBe(2);
    expect(result[0]?.decoded).toBe("Better Guess");
  });

  test("does not retry high-confidence items", async () => {
    let callCount = 0;
    stubGenerateObject({ items: [{ raw: "MLK", decoded: "Milk", confidence: 0.95 }] });
    _deps.generateObject = mock(async () => {
      callCount++;
      return { object: { items: [{ raw: "MLK", decoded: "Milk", confidence: 0.95 }] } };
    }) as any;

    await decodeReceiptItems([{ description: "MLK" }]);
    expect(callCount).toBe(1);
  });

  test("falls back to raw description on error", async () => {
    _deps.generateObject = mock(async () => { throw new Error("API error"); }) as any;

    const result = await decodeReceiptItems([{ description: "TEST" }]);
    expect(result[0]?.decoded).toBe("TEST");
    expect(result[0]?.confidence).toBe(0.3);
  });
});

describe("estimateExpiration", () => {
  test("returns expiration estimate", async () => {
    stubGenerateObject({ days: 7, label: "~1 week", confidence: "high" });

    const result = await estimateExpiration("Milk");
    expect(result.days).toBe(7);
    expect(result.label).toBe("~1 week");
    expect(result.confidence).toBe("high");
  });

  test("includes category in prompt", async () => {
    let capturedMessages: any[] = [];
    _deps.generateObject = mock(async (params: any) => {
      capturedMessages = params.messages;
      return { object: { days: 30, label: "~1 month", confidence: "medium" } };
    }) as any;

    await estimateExpiration("Cheese", "Dairy");
    expect(capturedMessages.some((m: any) => m.content?.includes("Dairy"))).toBe(true);
  });

  test("caches results", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount++;
      return { object: { days: 14, label: "~2 weeks", confidence: "high" } };
    }) as any;

    await estimateExpiration("Bread");
    await estimateExpiration("Bread");
    expect(callCount).toBe(1);
  });

  test("uses separate cache keys per product+category", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount++;
      return { object: { days: 10, label: "~10 days", confidence: "medium" } };
    }) as any;

    await estimateExpiration("Cheese");
    await estimateExpiration("Cheese", "Dairy");
    expect(callCount).toBe(2);
  });

  test("falls back to conservative estimate on error", async () => {
    _deps.generateObject = mock(async () => { throw new Error("API error"); }) as any;

    const result = await estimateExpiration("Unknown");
    expect(result.days).toBe(7);
    expect(result.confidence).toBe("low");
  });
});

describe("clearExpirationCache", () => {
  test("forces a fresh API call after clearing", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount++;
      return { object: { days: 7, label: "~1 week", confidence: "high" } };
    }) as any;

    await estimateExpiration("Product");
    await estimateExpiration("Product"); // cached
    expect(callCount).toBe(1);

    clearExpirationCache();
    await estimateExpiration("Product"); // cache cleared, re-fetches
    expect(callCount).toBe(2);
  });
});
