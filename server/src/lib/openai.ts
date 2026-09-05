import { z } from "zod";
import { APICallError, type LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import {
  _deps,
  getModel,
  getVisionModel,
  getModelForHousehold,
  resolveLLMCredentials,
  type HouseholdLLMProvider,
} from "./llm";
import { db } from "./db";
import { householdLlmSettings } from "../db/schema";
import type { EncryptedSecret } from "./crypto";
import { FOOD_CATEGORIES, FoodCategory } from "./categories";

// ---------------------------------------------------------------------------------
// Household-aware credential resolution (plan §4.5, §6) — unifies these five
// call sites (receipt OCR, expiration estimation, brand extraction, name
// normalization, item-default suggestion) with meal planning's BYO-key model. This
// module deliberately reuses `resolveLLMCredentials`/`getModelForHousehold` from
// `./llm` rather than re-implementing precedence; it does NOT modify llm.ts.
//
// Household context is OPTIONAL and best-effort everywhere in this file: passing no
// `householdId` (or a household with no configured key, or a household whose stored
// key fails to decrypt) falls all the way back to today's exact env-only behavior via
// `getModel()`/`getVisionModel()`. These five functions are non-blocking conveniences
// (item creation, background image resolution, receipt parsing) — a broken household
// key must never throw into the calling route; see each function's existing
// catch/fallback below, which is preserved unchanged.
//
// Vision decision (receipt OCR): a household's chosen CHAT model may not be
// vision-capable, so `parseReceiptImage` resolves the household's KEY + PROVIDER but
// the vision MODEL id comes from a dedicated `household_llm_settings.vision_model`
// column — never the household's saved `model` (chat) preference. Precedence:
// household `visionModel` → `LLM_VISION_MODEL` → the per-provider default map below →
// the legacy fully-env-driven `getVisionModel()` (households on a provider with no
// known vision-capable default, currently openrouter, land here whenever no override
// is configured, rather than guessing a model id).
// ---------------------------------------------------------------------------------

type HouseholdLlmRow = typeof householdLlmSettings.$inferSelect;

async function loadHouseholdLlmRowImpl(householdId: string): Promise<HouseholdLlmRow | undefined> {
  const [row] = await db
    .select()
    .from(householdLlmSettings)
    .where(eq(householdLlmSettings.householdId, householdId));
  return row;
}

// Mutable deps object (mirrors `_deps` in ./llm) — lets tests stub the household
// settings lookup with an in-memory row (built from the real `encryptSecret`, so
// decryption/AAD behavior is exercised for real) instead of hitting Postgres.
export const _householdDeps = { loadHouseholdLlmRow: loadHouseholdLlmRowImpl };

function storedSecretFromRow(row: HouseholdLlmRow | undefined): EncryptedSecret | null {
  if (!row?.apiKeyCiphertext || !row.apiKeyIv || !row.apiKeyTag) return null;
  return {
    ciphertext: row.apiKeyCiphertext,
    iv: row.apiKeyIv,
    tag: row.apiKeyTag,
    kekVersion: row.kekVersion,
  };
}

/** Logs only a fixed error name/identity — never the error's message, which for
 * provider API-call errors can echo the submitted key or an Authorization fragment
 * (the same concern documented in routes/settings.ts's classifyProviderError). Both
 * SecretDecryptionError and KekConfigError carry fixed, non-parameterized messages, so
 * this is safe purely by construction, not by omission. */
function logCredentialFallback(context: string, error: unknown): void {
  console.error(
    `${context}, falling back to env default:`,
    error instanceof Error ? error.name : "unknown"
  );
}

/**
 * Reduces an error to something safe to pass to `console.error`. These functions can
 * now be reached with a HOUSEHOLD's own supplied API key (not just the operator's env
 * key), so a bad key producing a provider 401/429 is no longer a hypothetical: OpenAI
 * and OpenRouter error bodies routinely echo the submitted key or an Authorization
 * fragment (the same concern documented in routes/settings.ts's classifyProviderError).
 * `APICallError`s are reduced to just a status code; everything else keeps its
 * name/message (schema-validation failures, timeouts, network errors — none of these
 * carry request/response body text that could contain key material).
 */
function safeErrorForLog(error: unknown): unknown {
  if (APICallError.isInstance(error)) {
    return { name: "APICallError", statusCode: error.statusCode };
  }
  return error instanceof Error ? { name: error.name, message: error.message } : error;
}

/** Mirrors `getModel()`'s own env resolution — used only to key the in-memory caches,
 * never to construct a model itself (that stays inside `getModel()`). */
function envTextCacheKeyPart(): string {
  return `${process.env.LLM_PROVIDER ?? "openai"}:${process.env.LLM_MODEL ?? "default"}`;
}

interface ResolvedModel {
  model: LanguageModel;
  /** Opaque fragment folded into cache keys so two households on different
   * providers/models never share a cached result. */
  cacheKeyPart: string;
}

/**
 * Resolves the LanguageModel + cache-key fragment for a TEXT generation call
 * (expiration estimate, brand extraction, name normalization, item defaults).
 * Household resolution failures of any kind (no key configured, a stored key that
 * fails to decrypt, a DB error) are caught here and degrade to the legacy env-only
 * `getModel()` — this module never lets a credentials problem propagate into the
 * calling route.
 */
async function resolveTextModel(householdId?: string): Promise<ResolvedModel> {
  if (householdId) {
    try {
      const row = await _householdDeps.loadHouseholdLlmRow(householdId);
      const resolved = await resolveLLMCredentials({
        householdId,
        provider: (row?.provider as HouseholdLLMProvider | undefined) ?? null,
        model: row?.model ?? null,
        storedSecret: storedSecretFromRow(row),
      });
      if (resolved.ok) {
        const { provider, model, apiKey } = resolved.credentials;
        return {
          model: getModelForHousehold({ provider, model, apiKey }),
          cacheKeyPart: `${provider}:${model}`,
        };
      }
    } catch (error) {
      logCredentialFallback("LLM household credential resolution failed", error);
    }
  }

  return { model: getModel(), cacheKeyPart: envTextCacheKeyPart() };
}

/** Per-provider vision-capable default model ids. Deliberately duplicated from
 * llm.ts's private `DEFAULT_VISION_MODELS` (openai/anthropic only) rather than
 * exported from there — this change is scoped to stay out of llm.ts entirely. Keep
 * these two values in sync with llm.ts if either changes. Exported so
 * routes/settings.ts can surface the same fallback in `envDefaults.visionModel`
 * without duplicating the map a third time. */
export const HOUSEHOLD_VISION_DEFAULT_MODELS: Partial<Record<HouseholdLLMProvider, string>> = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-sonnet-4-6",
};

/**
 * Resolves the LanguageModel for receipt OCR. Resolves the household's KEY +
 * PROVIDER the same way `resolveTextModel` does. The MODEL id follows the household
 * `visionModel` → `LLM_VISION_MODEL` → per-provider default map precedence (see module
 * doc) — never the household's saved chat `model`.
 */
async function resolveVisionModel(householdId?: string): Promise<LanguageModel> {
  if (householdId) {
    try {
      const row = await _householdDeps.loadHouseholdLlmRow(householdId);
      const resolved = await resolveLLMCredentials({
        householdId,
        provider: (row?.provider as HouseholdLLMProvider | undefined) ?? null,
        model: row?.model ?? null,
        storedSecret: storedSecretFromRow(row),
      });
      if (resolved.ok) {
        const { provider, apiKey } = resolved.credentials;
        const visionModelId =
          row?.visionModel ??
          process.env.LLM_VISION_MODEL ??
          HOUSEHOLD_VISION_DEFAULT_MODELS[provider];
        if (visionModelId) {
          return getModelForHousehold({ provider, model: visionModelId, apiKey });
        }
        // No known vision-capable default for this provider (e.g. openrouter) —
        // fall through to the fully env-driven legacy path below.
      }
    } catch (error) {
      logCredentialFallback("LLM household credential resolution failed for vision", error);
    }
  }

  return getVisionModel();
}

export interface ExpirationEstimate {
  days: number;
  label: string;
  confidence: "high" | "medium" | "low";
}

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

// In-memory caches with 24h TTL
const expirationCache = new Map<string, { estimate: ExpirationEstimate; expiresAt: number }>();
const brandCache = new Map<string, { brand: string | null; expiresAt: number }>();
const normalizeCache = new Map<string, { normalized: string; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function parseReceiptImage(
  imageBase64: string,
  householdId?: string
): Promise<ReceiptParseResult> {
  const { object } = await _deps.generateObject({
    model: await resolveVisionModel(householdId),
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

export async function estimateExpiration(
  productName: string,
  category?: string,
  householdId?: string
): Promise<ExpirationEstimate> {
  const { model, cacheKeyPart } = await resolveTextModel(householdId);
  const cacheKey = `${productName.toLowerCase().trim()}|${(category ?? "").toLowerCase().trim()}|${cacheKeyPart}`;
  const cached = expirationCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.estimate;

  try {
    const { object } = await _deps.generateObject({
      model,
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

    const estimate = object as ExpirationEstimate;
    expirationCache.set(cacheKey, { estimate, expiresAt: Date.now() + CACHE_TTL });
    return estimate;
  } catch (error) {
    console.error("Error estimating expiration:", safeErrorForLog(error));
    return { days: 7, label: "~1 week", confidence: "low" };
  }
}

export function clearExpirationCache(): void {
  expirationCache.clear();
}

export function clearBrandCache(): void {
  brandCache.clear();
}

export function clearNormalizeCache(): void {
  normalizeCache.clear();
}

export async function extractBrandFromName(
  productName: string,
  householdId?: string
): Promise<string | null> {
  const { model, cacheKeyPart } = await resolveTextModel(householdId);
  const cacheKey = `${productName.toLowerCase().trim()}|${cacheKeyPart}`;
  const cached = brandCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.brand;

  try {
    const { object } = await _deps.generateObject({
      model,
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

    const brand = (object as { brand: string | null }).brand ?? null;
    brandCache.set(cacheKey, { brand, expiresAt: Date.now() + CACHE_TTL });
    return brand;
  } catch (error) {
    console.error("Error extracting brand from product name:", safeErrorForLog(error));
    return null;
  }
}

/**
 * Normalizes a raw item name to its simplest form for image/category lookup.
 * Strips brand names, sizes, adjectives, and modifiers.
 * e.g. "Granny Smith Apples organic 3lb bag" → "apple"
 * Cached 24h; falls back to the original name on LLM error.
 */
export async function normalizeItemName(name: string, householdId?: string): Promise<string> {
  const { model, cacheKeyPart } = await resolveTextModel(householdId);
  const cacheKey = `${name.toLowerCase().trim()}|${cacheKeyPart}`;
  const cached = normalizeCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.normalized;

  try {
    const { object } = await _deps.generateObject({
      model,
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

    const normalized = (object as { normalized: string }).normalized || name;
    normalizeCache.set(cacheKey, { normalized, expiresAt: Date.now() + CACHE_TTL });
    return normalized;
  } catch {
    return name;
  }
}

export interface ItemSuggestion {
  unit: string;
  category: FoodCategory;
  estimatedShelfDays: number;
}

export const SuggestionSchema = z.object({
  unit: z.enum(["unit", "lb", "oz", "fl oz", "bunch"]).describe("Standard unit of measure."),
  category: z.enum(FOOD_CATEGORIES).describe("Best-matching food category from the allowed list."),
  estimatedShelfDays: z
    .number()
    .int()
    .positive()
    .describe(
      "Days from purchase until typical expiration, assuming unopened and correctly stored."
    ),
});

const suggestionCache = new Map<string, { suggestion: ItemSuggestion; expiresAt: number }>();

export function clearSuggestionCache(): void {
  suggestionCache.clear();
}

export async function suggestItemDefaults(
  name: string,
  householdId?: string
): Promise<ItemSuggestion> {
  const { model, cacheKeyPart } = await resolveTextModel(householdId);
  const key = `${name.toLowerCase().trim()}|${cacheKeyPart}`;
  const cached = suggestionCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.suggestion;

  try {
    const { object } = await _deps.generateObject({
      model,
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

    const suggestion = object as ItemSuggestion;
    suggestionCache.set(key, { suggestion, expiresAt: Date.now() + CACHE_TTL });
    return suggestion;
  } catch (error) {
    console.error("Error suggesting item defaults:", safeErrorForLog(error));
    return { unit: "unit", category: "Other", estimatedShelfDays: 7 };
  }
}
