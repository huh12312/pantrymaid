/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, afterEach, mock } from "bun:test";
import {
  estimateExpiration,
  parseReceiptImage,
  extractBrandFromName,
  normalizeItemName,
  suggestItemDefaults,
  clearExpirationCache,
  clearBrandCache,
  clearNormalizeCache,
  clearSuggestionCache,
  ReceiptParseResultSchema,
  ExpirationEstimateSchema,
  SuggestionSchema,
} from "../../lib/openai";
import { _deps } from "../../lib/llm";
import { FOOD_CATEGORIES } from "../../lib/categories";

const originalGenerateObject = _deps.generateObject;

function stubGenerateObject(returnValue: unknown) {
  _deps.generateObject = mock(async () => ({ object: returnValue })) as any;
}

afterEach(() => {
  _deps.generateObject = originalGenerateObject;
  clearExpirationCache();
  clearBrandCache();
  clearNormalizeCache();
  clearSuggestionCache();
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
    _deps.generateObject = mock(async () => {
      throw new Error("API error");
    }) as any;

    const result = await estimateExpiration("Unknown");
    expect(result.days).toBe(7);
    expect(result.confidence).toBe("low");
  });
});

describe("estimateExpiration prompt", () => {
  test("system message contains storage assumption", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return { object: { days: 7, label: "~1 week", confidence: "high" } };
    }) as any;

    await estimateExpiration("Milk");

    expect(capturedParams.system).toContain("unopened");
    expect(capturedParams.system).toContain("refrigerate");
  });

  test("user message does not contain a 'Provide:' field list", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return { object: { days: 7, label: "~1 week", confidence: "high" } };
    }) as any;

    await estimateExpiration("Milk");

    const userText = capturedParams.messages[0].content as string;
    expect(userText).not.toContain("Provide:");
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

describe("FOOD_CATEGORIES", () => {
  test("exports a non-empty tuple of category strings", () => {
    expect(Array.isArray(FOOD_CATEGORIES)).toBe(true);
    expect(FOOD_CATEGORIES.length).toBeGreaterThan(0);
    expect(FOOD_CATEGORIES).toContain("Dairy");
    expect(FOOD_CATEGORIES).toContain("Produce");
    expect(FOOD_CATEGORIES).toContain("Other");
  });
});

describe("Zod schema describe annotations", () => {
  // NOTE: Zod 4 exposes .description (public getter) not ._def.description.
  // Array element schema is at .element.shape, not ._def.type.shape.
  // Enum discriminator is _def.type === "enum", not _def.typeName.

  test("ReceiptLineItemSchema.confidence has a describe annotation", () => {
    const shape = (ReceiptParseResultSchema.shape.lineItems as any).element.shape;
    expect(shape.confidence.description).toContain("0.9");
  });

  test("ExpirationEstimateSchema.days has a describe annotation", () => {
    expect(ExpirationEstimateSchema.shape.days.description).toBeTruthy();
  });

  test("ExpirationEstimateSchema.confidence has a describe annotation", () => {
    expect(ExpirationEstimateSchema.shape.confidence.description).toContain("high");
  });

  test("SuggestionSchema.category is a Zod enum (not plain string)", () => {
    expect((SuggestionSchema.shape.category as any)._def.type).toBe("enum");
  });

  test("SuggestionSchema.unit has a describe annotation", () => {
    expect(SuggestionSchema.shape.unit.description).toContain("unit");
  });
});

describe("parseReceiptImage prompt", () => {
  test("sends a system message containing receipt OCR role and abbreviation table", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return {
        object: { storeName: "Walmart", lineItems: [], total: null },
      };
    }) as any;

    await parseReceiptImage("aGVsbG8=");

    expect(capturedParams.system).toContain("receipt OCR");
    expect(capturedParams.system).toContain("GV / GRT VL");
    expect(capturedParams.system).toContain("bag fees");
  });

  test("user message does not contain field documentation (storeName, lineItems)", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return {
        object: { storeName: null, lineItems: [], total: null },
      };
    }) as any;

    await parseReceiptImage("aGVsbG8=");

    const userText =
      capturedParams.messages[0].content.find((c: any) => c.type === "text")?.text ?? "";
    expect(userText).not.toContain("storeName");
    expect(userText).not.toContain("lineItems");
  });
});

describe("extractBrandFromName prompt", () => {
  test("system message contains house-brand examples (Great Value, Kirkland)", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return { object: { brand: "Heinz" } };
    }) as any;

    await extractBrandFromName("Heinz Original Ketchup 24oz");

    expect(capturedParams.system).toContain("Great Value");
    expect(capturedParams.system).toContain("Kirkland Signature");
  });

  test("system message specifies title case output", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return { object: { brand: null } };
    }) as any;

    await extractBrandFromName("Salt");

    expect(capturedParams.system).toContain("title case");
  });
});

describe("normalizeItemName prompt", () => {
  test("examples are in the system message, not the user message", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return { object: { normalized: "apple" } };
    }) as any;

    await normalizeItemName("Granny Smith Apples organic 3lb bag");

    expect(capturedParams.system).toContain("apple");
    const userText = capturedParams.messages[0].content as string;
    expect(userText).not.toContain("Examples:");
  });

  test("system message explains compound food name exception", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return { object: { normalized: "almond milk" } };
    }) as any;

    await normalizeItemName("Blue Diamond Almond Breeze Unsweetened");

    expect(capturedParams.system).toContain("almond milk");
  });
});

describe("suggestItemDefaults prompt", () => {
  test("system message contains unit conventions table", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return {
        object: { unit: "unit", category: "Produce", estimatedShelfDays: 21 },
      };
    }) as any;

    await suggestItemDefaults("apple");

    expect(capturedParams.system).toContain("fl oz");
    expect(capturedParams.system).toContain("bunch");
  });

  test("user message does not contain the category list (it is on the schema)", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return {
        object: { unit: "lb", category: "Meat & Poultry", estimatedShelfDays: 2 },
      };
    }) as any;

    await suggestItemDefaults("ground beef");

    const userText = capturedParams.messages[0].content as string;
    expect(userText).not.toContain("Valid categories:");
  });

  test("system message contains storage assumption", async () => {
    let capturedParams: any;
    _deps.generateObject = mock(async (params: any) => {
      capturedParams = params;
      return {
        object: { unit: "unit", category: "Produce", estimatedShelfDays: 21 },
      };
    }) as any;

    await suggestItemDefaults("apple");

    expect(capturedParams.system).toContain("unopened");
  });
});

describe("cache key normalization", () => {
  test("estimateExpiration treats 'Milk' and 'milk' as the same cache key", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount++;
      return { object: { days: 10, label: "~10 days", confidence: "high" } };
    }) as any;

    await estimateExpiration("Milk");
    await estimateExpiration("milk");
    expect(callCount).toBe(1);

    clearExpirationCache();
  });

  test("normalizeItemName treats 'Apple' and ' apple ' as the same cache key", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount++;
      return { object: { normalized: "apple" } };
    }) as any;

    await normalizeItemName("Apple");
    await normalizeItemName(" apple ");
    expect(callCount).toBe(1);

    clearNormalizeCache();
  });

  test("extractBrandFromName treats 'Heinz Ketchup' and 'heinz ketchup' as the same cache key", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount++;
      return { object: { brand: "Heinz" } };
    }) as any;

    await extractBrandFromName("Heinz Ketchup");
    await extractBrandFromName("heinz ketchup");
    expect(callCount).toBe(1);

    clearBrandCache();
  });
});
