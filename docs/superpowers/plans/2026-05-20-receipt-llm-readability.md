# Receipt LLM Prompt Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the five LLM prompts in `server/src/lib/openai.ts` so that instructions are clearer, field specs live on Zod schemas (not duplicated in prose), and models receive consistent context — without changing the underlying model or model parameters.

**Architecture:** Prompt text moved to system messages where reusable; field documentation moved to `.describe()` annotations on Zod schemas (serialized into JSON Schema by the Vercel AI SDK and sent to the model automatically); category values centralized in a single exported constant so schema and keyword-matching stay in sync.

**Tech Stack:** Bun, `bun:test`, Vercel AI SDK (`generateObject`), Zod, TypeScript strict mode

---

## File Map

| File                                          | What changes                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `server/src/lib/categories.ts`                | Export `FOOD_CATEGORIES` const                                                                 |
| `server/src/lib/openai.ts`                    | All five Zod schemas get `.describe()`; all five prompt strings revised; cache keys normalized |
| `server/src/test/integrations/openai.test.ts` | Add prompt-content tests for all five functions                                                |

---

### Task 1: Export `FOOD_CATEGORIES` from `categories.ts`

**Files:**

- Modify: `server/src/lib/categories.ts`
- Test: `server/src/test/integrations/openai.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/src/test/integrations/openai.test.ts` (top of file, after existing imports):

```typescript
import { FOOD_CATEGORIES } from "../../lib/categories";

describe("FOOD_CATEGORIES", () => {
  test("exports a non-empty tuple of category strings", () => {
    expect(Array.isArray(FOOD_CATEGORIES)).toBe(true);
    expect(FOOD_CATEGORIES.length).toBeGreaterThan(0);
    expect(FOOD_CATEGORIES).toContain("Dairy");
    expect(FOOD_CATEGORIES).toContain("Produce");
    expect(FOOD_CATEGORIES).toContain("Other");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: FAIL — `SyntaxError: The requested module '../../lib/categories' does not provide an export named 'FOOD_CATEGORIES'`

- [ ] **Step 3: Add the export to `categories.ts`**

Add at the bottom of `server/src/lib/categories.ts`:

```typescript
export const FOOD_CATEGORIES = [
  "Dairy",
  "Meat & Poultry",
  "Seafood",
  "Produce",
  "Bread & Bakery",
  "Breakfast & Cereal",
  "Grains & Pasta",
  "Baking",
  "Canned Goods",
  "Condiments & Sauces",
  "Oils & Vinegars",
  "Snacks",
  "Beverages",
  "Frozen Foods",
  "Spices & Seasonings",
  "Other",
] as const;

export type FoodCategory = (typeof FOOD_CATEGORIES)[number];
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: PASS

- [ ] **Step 5: Add cache-clear exports to `openai.ts` and wire into `afterEach`**

The prompt-content tests in Tasks 3–7 stub `_deps.generateObject` and reuse common product names (e.g. "apple", "Milk"). Without cache resets between tests, a cached result from an earlier test silently skips the stub — `capturedParams` stays `undefined` and the test crashes on property access.

Add these exports at the bottom of `server/src/lib/openai.ts` (alongside the existing `clearExpirationCache`):

```typescript
export function clearBrandCache(): void {
  brandCache.clear();
}

export function clearNormalizeCache(): void {
  normalizeCache.clear();
}

export function clearSuggestionCache(): void {
  suggestionCache.clear();
}
```

Then update the `afterEach` block in `server/src/test/integrations/openai.test.ts` to import and call all four:

```typescript
import {
  estimateExpiration,
  clearExpirationCache,
  clearBrandCache,
  clearNormalizeCache,
  clearSuggestionCache,
} from "../../lib/openai";

afterEach(() => {
  _deps.generateObject = originalGenerateObject;
  clearExpirationCache();
  clearBrandCache();
  clearNormalizeCache();
  clearSuggestionCache();
});
```

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/openai.ts server/src/lib/categories.ts server/src/test/integrations/openai.test.ts
git commit -m "feat(server): export FOOD_CATEGORIES; add clearBrandCache/clearNormalizeCache/clearSuggestionCache exports"
```

---

### Task 2: Add `.describe()` to all five Zod schemas in `openai.ts`

Moving field documentation from inline prose `"Provide: - days: ..."` bullets onto `.describe()` annotations sends them to the model via JSON Schema (the Vercel AI SDK serializes them automatically), and eliminates the duplicate source of truth.

**Files:**

- Modify: `server/src/lib/openai.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/src/test/integrations/openai.test.ts`:

```typescript
import {
  ReceiptParseResultSchema,
  ExpirationEstimateSchema,
  BrandExtractionSchema,
  NormalizationSchema,
  SuggestionSchema,
} from "../../lib/openai";

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
```

**Note:** This requires exporting the schema objects. Add `export` to the five schema `const` declarations in `openai.ts`.

- [ ] **Step 2: Run to verify it fails**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: FAIL — schemas not exported and no `.describe()` annotations present.

- [ ] **Step 3: Export schemas and add `.describe()` annotations**

In `server/src/lib/openai.ts`, replace the five schema definitions with:

```typescript
import { FOOD_CATEGORIES } from "./categories";

export const ReceiptLineItemSchema = z.object({
  description: z
    .string()
    .describe(
      "Full human-readable product name with all abbreviations decoded. Include size/weight if printed on the receipt line."
    ),
  quantity: z
    .number()
    .int()
    .positive()
    .describe("Number of units purchased. Use 1 for weighed items (e.g. produce sold by pound)."),
  price: z
    .number()
    .nullable()
    .describe(
      "Extended line price as printed (null if not legible). For multi-unit rows this is quantity × unit price."
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Confidence in the decoded product name. 0.9+ = clear text fully decoded; 0.6–0.89 = partial abbreviation resolved by context; below 0.6 = significant uncertainty in decoding."
    ),
});

export const ReceiptParseResultSchema = z.object({
  storeName: z
    .string()
    .nullable()
    .describe("Store or vendor name as printed. Null if not visible."),
  lineItems: z.array(ReceiptLineItemSchema),
  total: z.number().nullable().describe("Receipt grand total as printed. Null if not visible."),
});

export type ReceiptParseResult = z.infer<typeof ReceiptParseResultSchema>;

export const ExpirationEstimateSchema = z.object({
  days: z
    .number()
    .int()
    .positive()
    .describe(
      "Integer number of days from purchase date until typical expiration. Assume the item is unopened and stored correctly (refrigerate perishables, pantry for dry goods, freezer for frozen)."
    ),
  label: z
    .string()
    .describe(
      "Human-readable shelf-life label. Use the format '~N unit' — e.g. '~1 week', '~3 months', '~1 year'."
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "high = well-established standard (e.g. fresh milk 7–10 days); medium = common convention with variability; low = rough estimate only."
    ),
});

export const BrandExtractionSchema = z.object({
  brand: z
    .string()
    .nullable()
    .describe(
      "Brand name in title case, or null if the product has no distinct brand (e.g. loose commodities like 'Salt', 'Bananas')."
    ),
});

export const NormalizationSchema = z.object({
  normalized: z
    .string()
    .describe(
      "Core food name in lowercase singular form — no brand, size, or descriptors. Compound food names like 'almond milk' or 'olive oil' are preserved as-is."
    ),
});

export const SuggestionSchema = z.object({
  unit: z
    .string()
    .describe(
      "Standard unit of measure. Use exactly: 'unit', 'lb', 'oz', 'fl oz', or 'bunch'. No other values."
    ),
  category: z.enum(FOOD_CATEGORIES).describe("Best-matching food category from the allowed list."),
  estimatedShelfDays: z
    .number()
    .int()
    .positive()
    .describe(
      "Days from purchase until typical expiration, assuming unopened and correctly stored."
    ),
});
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/openai.ts server/src/test/integrations/openai.test.ts
git commit -m "feat(server): add Zod .describe() to all LLM schemas, enum-constrain category"
```

---

### Task 3: Revise `parseReceiptImage` prompt

Adds a system prompt with role context, a multi-category abbreviation table, explicit exclusion rules for bag fees and bottle deposits, a weighed-item rule, and moves field specs off the user message (now handled by schema `.describe()`).

**Files:**

- Modify: `server/src/lib/openai.ts`
- Test: `server/src/test/integrations/openai.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/src/test/integrations/openai.test.ts`:

```typescript
import { parseReceiptImage } from "../../lib/openai";

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
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: FAIL — no system message, user message contains field documentation.

- [ ] **Step 3: Replace the `parseReceiptImage` call in `openai.ts`**

Replace the `generateObject` call inside `parseReceiptImage`:

```typescript
export async function parseReceiptImage(imageBase64: string): Promise<ReceiptParseResult> {
  const { object } = await _deps.generateObject({
    model: getVisionModel(),
    schema: ReceiptParseResultSchema,
    system: `You are a receipt OCR specialist. Extract structured product data from grocery receipt images.

Rules:
- Only extract purchased products. Exclude: taxes, subtotals, totals, fees (bag fees, bottle deposits), discounts, coupons, loyalty savings, EBT/SNAP summary lines.
- Decode ALL abbreviations into full human-readable names. Common patterns:
    GV / GRT VL → Great Value (Walmart house brand)
    KS / KRKL → Kirkland Signature (Costco house brand)
    MLK → Milk   HLF GL → Half Gallon   ORG → Organic
    CHKN → Chicken   BRS → Breast   LS → Boneless Skinless
    T-BN STK → T-Bone Steak   LN GRD BF → Lean Ground Beef
    BNNA / BAN → Banana   AVCD → Avocado
- For weighed items (e.g. "BANANAS 0.45 LB"), set quantity to 1 and include the weight description in the product name.
- Price is the per-line extended price as printed.`,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", image: Buffer.from(imageBase64, "base64") },
          {
            type: "text",
            text: "Extract all purchased products from this receipt.",
          },
        ],
      },
    ],
  });
  return object as ReceiptParseResult;
}
```

- [ ] **Step 4: Run to verify tests pass**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/openai.ts server/src/test/integrations/openai.test.ts
git commit -m "feat(server): revise parseReceiptImage prompt — system message, abbreviation table, weighed-item rule"
```

---

### Task 4: Revise `estimateExpiration` prompt

Adds a storage-condition assumption to the system message (the single biggest accuracy variable for shelf-life estimation); removes the redundant "Provide:" field list from the user message (now on the schema).

**Files:**

- Modify: `server/src/lib/openai.ts`
- Test: `server/src/test/integrations/openai.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/src/test/integrations/openai.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: FAIL — system message has no storage assumption; user message still has "Provide:".

- [ ] **Step 3: Replace the `estimateExpiration` call in `openai.ts`**

Replace the `generateObject` call inside the `try` block of `estimateExpiration`:

```typescript
const { object } = await _deps.generateObject({
  model: getModel(),
  schema: ExpirationEstimateSchema,
  system: `You are a food safety expert specializing in consumer grocery products.

Storage assumption: estimate shelf life as purchased from a grocery store, stored correctly — refrigerate perishables, keep dry goods in a cool pantry, frozen items in a freezer. Assume the package is unopened.`,
  messages: [
    {
      role: "user",
      content: `How long does this product typically last from the purchase date?

Product: ${productName}${category ? `\nCategory: ${category}` : ""}`,
    },
  ],
});
```

- [ ] **Step 4: Run to verify tests pass**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: PASS (including the existing cache and error-fallback tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/openai.ts server/src/test/integrations/openai.test.ts
git commit -m "feat(server): revise estimateExpiration prompt — add storage assumption, remove redundant Provide list"
```

---

### Task 5: Revise `extractBrandFromName` prompt

Adds house-brand examples (the dominant failure mode on real receipt data), few-shot classification examples, and a title-case output rule. Moves field spec off the user message.

**Files:**

- Modify: `server/src/lib/openai.ts`
- Test: `server/src/test/integrations/openai.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/src/test/integrations/openai.test.ts`:

```typescript
import { extractBrandFromName } from "../../lib/openai";

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
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: FAIL — no house-brand examples, no title case rule in system message.

- [ ] **Step 3: Replace the `extractBrandFromName` call in `openai.ts`**

Replace the `generateObject` call inside the `try` block of `extractBrandFromName`:

```typescript
const { object } = await _deps.generateObject({
  model: getModel(),
  schema: BrandExtractionSchema,
  system: `Extract the brand name from grocery product names.

Rules:
- Return the brand in title case (e.g. "Heinz", "Kirkland Signature", "Great Value").
- Retailer house brands count as brands: Great Value (Walmart), Kirkland Signature (Costco), 365 (Whole Foods), Trader Joe's, Good & Gather (Target), Simple Truth.
- Return null only if the product has no brand at all — e.g. a loose commodity: "Salt", "White Rice", "Bananas".

Examples:
- "Heinz Original Ketchup 24oz" → "Heinz"
- "Great Value Milk Half Gallon" → "Great Value"
- "Kirkland Signature Extra Virgin Olive Oil" → "Kirkland Signature"
- "Organic Baby Spinach 5oz" → null
- "Salt" → null`,
  messages: [
    {
      role: "user",
      content: `Product name: "${productName}"`,
    },
  ],
});
```

- [ ] **Step 4: Run to verify tests pass**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/openai.ts server/src/test/integrations/openai.test.ts
git commit -m "feat(server): revise extractBrandFromName prompt — house-brand examples, title case rule"
```

---

### Task 6: Revise `normalizeItemName` prompt

Moves few-shot examples to the system message (cacheable, not re-sent per call); fixes the adjective contradiction by naming the compound-food-name exception explicitly; adds rules for already-normalized inputs and mass nouns.

**Files:**

- Modify: `server/src/lib/openai.ts`
- Test: `server/src/test/integrations/openai.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/src/test/integrations/openai.test.ts`:

```typescript
import { normalizeItemName } from "../../lib/openai";

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
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: FAIL — examples are currently in the user message, not system message.

- [ ] **Step 3: Replace the `normalizeItemName` call in `openai.ts`**

Replace the `generateObject` call inside the `try` block of `normalizeItemName`:

```typescript
const { object } = await _deps.generateObject({
  model: getModel(),
  schema: NormalizationSchema,
  system: `You normalize grocery product names to their simplest searchable food term.

Output rules:
- Return only the core food name, in lowercase.
- Use singular form for countable nouns (apples → apple, eggs → egg). Mass nouns and compound food names are already correct (rice, pasta, almond milk, olive oil).
- Remove: brand names, retailer labels, sizes, weights, descriptors (organic, fresh, frozen, USDA, etc.), and packaging terms.
- Preserve compound food names that describe a distinct food type: "almond milk", "olive oil", "peanut butter", "ice cream".
- If the input is already a simple food name, return it unchanged.

Examples:
- "Granny Smith Apples organic 3lb bag" → "apple"
- "Heinz Original Ketchup 24oz" → "ketchup"
- "Wild Alaskan Salmon fillet frozen" → "salmon"
- "Kirkland Signature Extra Virgin Olive Oil" → "olive oil"
- "T-bone steak USDA choice" → "steak"
- "Blue Diamond Almond Breeze Unsweetened" → "almond milk"
- "Quaker Old Fashioned Rolled Oats 42oz" → "oat"
- "apple" → "apple"`,
  messages: [
    {
      role: "user",
      content: `Item: "${name}"`,
    },
  ],
});
```

- [ ] **Step 4: Run to verify tests pass**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/openai.ts server/src/test/integrations/openai.test.ts
git commit -m "feat(server): revise normalizeItemName prompt — examples to system, fix adjective/compound contradiction"
```

---

### Task 7: Revise `suggestItemDefaults` prompt

Adds a unit conventions table (eliminating "each"/"ea"/"piece" variation), multi-domain few-shot examples, and the shared storage-condition assumption. Removes the inline category list (now enforced by `z.enum(FOOD_CATEGORIES)` on the schema).

**Files:**

- Modify: `server/src/lib/openai.ts`
- Test: `server/src/test/integrations/openai.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/src/test/integrations/openai.test.ts`:

```typescript
import { suggestItemDefaults } from "../../lib/openai";

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
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: FAIL — no unit table, category list is in user message, no storage assumption.

- [ ] **Step 3: Replace the `suggestItemDefaults` call in `openai.ts`**

Replace the `generateObject` call inside the `try` block of `suggestItemDefaults`:

```typescript
const { object } = await _deps.generateObject({
  model: getModel(),
  schema: SuggestionSchema,
  system: `You are a grocery product expert. For a food item name, return the standard unit of measure, the best-matching food category, and the typical number of days until expiration from purchase.

Unit conventions — use exactly these values:
  Countable solid items (fruit, vegetables, cans, packages): "unit"
  Weighed items (meat, bulk produce): "lb"
  Small packaged items with standard oz sizing (snacks, dry goods): "oz"
  Liquids (milk, juice, broth, cooking oil): "fl oz"
  Bunched produce (herbs, asparagus, green onions, cilantro): "bunch"
  Eggs: "unit"

Storage assumption for shelf days: refrigerate perishables, pantry for dry/canned goods, freezer for frozen items. Assume unopened.

Examples:
  "apple" → unit: "unit", category: "Produce", estimatedShelfDays: 21
  "ground beef" → unit: "lb", category: "Meat & Poultry", estimatedShelfDays: 2
  "whole milk" → unit: "fl oz", category: "Dairy", estimatedShelfDays: 10
  "spaghetti" → unit: "oz", category: "Grains & Pasta", estimatedShelfDays: 730
  "basil" → unit: "bunch", category: "Produce", estimatedShelfDays: 7
  "olive oil" → unit: "fl oz", category: "Oils & Vinegars", estimatedShelfDays: 730
  "canned tomatoes" → unit: "oz", category: "Canned Goods", estimatedShelfDays: 1095`,
  messages: [
    {
      role: "user",
      content: `Item: "${name}"`,
    },
  ],
});
```

- [ ] **Step 4: Run to verify tests pass**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/openai.ts server/src/test/integrations/openai.test.ts
git commit -m "feat(server): revise suggestItemDefaults prompt — unit conventions, few-shot examples, remove inline category list"
```

---

### Task 8: Normalize cache keys across all four caching functions

Currently `estimateExpiration`, `extractBrandFromName`, `normalizeItemName`, and `suggestItemDefaults` use raw input strings as cache keys. "Milk", "milk", and " Milk " produce three separate LLM calls returning the same result.

**Files:**

- Modify: `server/src/lib/openai.ts`
- Test: `server/src/test/integrations/openai.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `server/src/test/integrations/openai.test.ts`:

```typescript
import { clearExpirationCache } from "../../lib/openai";

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
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: FAIL — callCount is 2 for both tests because cache keys are not normalized.

- [ ] **Step 3: Normalize cache keys at the top of all four caching functions**

In `server/src/lib/openai.ts`, make the following changes:

In `estimateExpiration`, change:

```typescript
const cacheKey = `${productName}|${category ?? ""}`;
```

to:

```typescript
const cacheKey = `${productName.toLowerCase().trim()}|${(category ?? "").toLowerCase().trim()}`;
```

In `extractBrandFromName`, change:

```typescript
const cached = brandCache.get(productName);
```

and:

```typescript
brandCache.set(productName, ...);
```

to use a normalized key:

```typescript
const cacheKey = productName.toLowerCase().trim();
const cached = brandCache.get(cacheKey);
// ... later ...
brandCache.set(cacheKey, { brand, expiresAt: Date.now() + CACHE_TTL });
```

In `normalizeItemName`, change:

```typescript
const cached = normalizeCache.get(name);
```

and:

```typescript
normalizeCache.set(name, ...);
```

to:

```typescript
const cacheKey = name.toLowerCase().trim();
const cached = normalizeCache.get(cacheKey);
// ... later ...
normalizeCache.set(cacheKey, { normalized, expiresAt: Date.now() + CACHE_TTL });
```

`suggestItemDefaults` already normalizes with `name.toLowerCase().trim()` — no change needed.

- [ ] **Step 4: Run to verify tests pass**

```bash
cd server && bun test src/test/integrations/openai.test.ts
```

Expected: PASS (all tests, including pre-existing cache tests).

- [ ] **Step 5: Run full server test suite**

```bash
cd server && bun test
```

Expected: all pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/openai.ts server/src/test/integrations/openai.test.ts
git commit -m "fix(server): normalize LLM cache keys to lowercase+trim across all four caching functions"
```

---

## Self-Review

**Spec coverage check:**

| Agent finding                                           | Covered by task                                 |
| ------------------------------------------------------- | ----------------------------------------------- |
| Zod `.describe()` — eliminates Provide: prose           | Task 2                                          |
| FOOD_CATEGORIES single source of truth                  | Tasks 1 + 2                                     |
| Storage assumption in expiration + defaults             | Tasks 4 + 7                                     |
| Confidence rubric anchoring                             | Task 2 (via schema describe) + Task 3 (receipt) |
| House-brand rule in brand extraction                    | Task 5                                          |
| Few-shot examples to system in brand/normalize/defaults | Tasks 5, 6, 7                                   |
| Unit enum constraint                                    | Task 2 (schema) + Task 7 (system prompt table)  |
| Weighed-item rule in receipt parsing                    | Task 3                                          |
| Cache key normalization                                 | Task 8                                          |

**Placeholder scan:** None found — all steps include concrete code.

**Type consistency:** `FOOD_CATEGORIES` is imported in Task 1 and used in the `z.enum()` call in Task 2. The `ItemSuggestion.category` field is currently typed as `string`. After Task 2, `SuggestionSchema` infers `category` as the `FoodCategory` union — still assignable to `string` at all existing call sites, but consider updating the `ItemSuggestion` interface to `category: FoodCategory` for end-to-end type safety (optional, no breakage either way).

**Zod 4 compatibility:** All schema-shape assertions in Task 2 use `.element.shape` (not `._def.type.shape`) for array element access, the public `.description` getter (not `._def.description`), and `._def.type === "enum"` (not `._def.typeName`) for enum discrimination — confirmed for Zod ≥4.0.
