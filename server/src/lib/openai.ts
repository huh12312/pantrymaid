import { z } from "zod";
import { _deps, getModel } from "./llm";

export interface DecodedItem {
  raw: string;
  decoded: string;
  confidence: number;
}

export interface ExpirationEstimate {
  days: number;
  label: string;
  confidence: "high" | "medium" | "low";
}

const DecodedItemSchema = z.object({
  raw: z.string(),
  decoded: z.string(),
  confidence: z.number().min(0).max(1),
});

const DecodeResultSchema = z.object({
  items: z.array(DecodedItemSchema),
});

const ExpirationEstimateSchema = z.object({
  days: z.number().int().positive(),
  label: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

const BrandExtractionSchema = z.object({
  brand: z.string().nullable(),
});

const NormalizationSchema = z.object({
  normalized: z.string(),
});

// In-memory caches with 24h TTL
const expirationCache = new Map<string, { estimate: ExpirationEstimate; expiresAt: number }>();
const brandCache = new Map<string, { brand: string | null; expiresAt: number }>();
const normalizeCache = new Map<string, { normalized: string; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function decodeReceiptItems(
  lineItems: Array<{ description: string; qty?: number; price?: number }>,
  storeName?: string
): Promise<DecodedItem[]> {
  const userContent = `You are decoding grocery store receipt abbreviations. For each item, provide the decoded full name and a confidence score 0-1. Be conservative — if unsure, confidence < 0.7.

${storeName ? `Store: ${storeName}\n` : ""}Items to decode:
${lineItems.map((item, i) => `${i + 1}. ${item.description}`).join("\n")}`;

  try {
    const { object } = await _deps.generateObject({
      model: getModel(),
      schema: DecodeResultSchema,
      system: "You are a grocery receipt decoder. Decode abbreviated product names into full, human-readable names.",
      messages: [{ role: "user", content: userContent }],
    });

    const decoded = object.items as DecodedItem[];
    const lowConfidenceIndices = decoded
      .map((item, i) => (item.confidence < 0.7 ? i : -1))
      .filter((i) => i !== -1);

    if (lowConfidenceIndices.length > 0) {
      const lowConfidenceItems = lowConfidenceIndices.map((i) => lineItems[i]!);
      const retryContent = `These grocery receipt items had low confidence. Please try again with your best guess.

${storeName ? `Store: ${storeName}\n` : ""}Items to decode:
${lowConfidenceItems.map((item, i) => `${i + 1}. ${item.description}`).join("\n")}`;

      const { object: retryObject } = await _deps.generateObject({
        model: getModel(),
        schema: DecodeResultSchema,
        system: "You are a grocery receipt decoder. Make your best guess even with limited information.",
        messages: [{ role: "user", content: retryContent }],
      });

      lowConfidenceIndices.forEach((originalIndex, retryIndex) => {
        const retryItem = retryObject.items[retryIndex];
        if (retryItem) decoded[originalIndex] = retryItem as DecodedItem;
      });
    }

    return decoded;
  } catch (error) {
    console.error("Error decoding receipt items:", error);
    return lineItems.map((item) => ({
      raw: item.description,
      decoded: item.description,
      confidence: 0.3,
    }));
  }
}

export async function estimateExpiration(
  productName: string,
  category?: string
): Promise<ExpirationEstimate> {
  const cacheKey = `${productName}|${category ?? ""}`;
  const cached = expirationCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.estimate;

  try {
    const { object } = await _deps.generateObject({
      model: getModel(),
      schema: ExpirationEstimateSchema,
      system: "You are a food safety expert. Estimate typical shelf life for grocery products.",
      messages: [{
        role: "user",
        content: `Estimate the typical shelf life for this grocery product from purchase date:
Product: ${productName}
${category ? `Category: ${category}` : ""}

Provide:
- days: Number of days until expiration (from purchase date)
- label: Human-readable label (e.g., "~1 week", "~2 months", "~1 year")
- confidence: "high", "medium", or "low"`,
      }],
    });

    const estimate = object as ExpirationEstimate;
    expirationCache.set(cacheKey, { estimate, expiresAt: Date.now() + CACHE_TTL });
    return estimate;
  } catch (error) {
    console.error("Error estimating expiration:", error);
    return { days: 7, label: "~1 week", confidence: "low" };
  }
}

export function clearExpirationCache(): void {
  expirationCache.clear();
}

export async function extractBrandFromName(productName: string): Promise<string | null> {
  const cached = brandCache.get(productName);
  if (cached && Date.now() < cached.expiresAt) return cached.brand;

  try {
    const { object } = await _deps.generateObject({
      model: getModel(),
      schema: BrandExtractionSchema,
      system: "You are a grocery product expert. Extract the brand name from a product name if one is present. Return null if no distinct brand is present (e.g. generic items like 'Salt' or 'White Rice').",
      messages: [{
        role: "user",
        content: `Product name: "${productName}"\n\nWhat is the brand name, if any?`,
      }],
    });

    const brand = (object as { brand: string | null }).brand ?? null;
    brandCache.set(productName, { brand, expiresAt: Date.now() + CACHE_TTL });
    return brand;
  } catch (error) {
    console.error("Error extracting brand from product name:", error);
    return null;
  }
}

/**
 * Normalizes a raw item name to its simplest form for image/category lookup.
 * Strips brand names, sizes, adjectives, and modifiers.
 * e.g. "Granny Smith Apples organic 3lb bag" → "apple"
 * Cached 24h; falls back to the original name on LLM error.
 */
export async function normalizeItemName(name: string): Promise<string> {
  const cached = normalizeCache.get(name);
  if (cached && Date.now() < cached.expiresAt) return cached.normalized;

  try {
    const { object } = await _deps.generateObject({
      model: getModel(),
      schema: NormalizationSchema,
      system: "You normalize grocery item names for image search. Return only the core food name in lowercase singular form — no brand, no size, no adjectives.",
      messages: [{
        role: "user",
        content: `Examples:
- "Granny Smith Apples organic 3lb bag" → "apple"
- "Heinz Original Ketchup 24oz" → "ketchup"
- "Wild Alaskan Salmon fillet frozen" → "salmon"
- "Kirkland Signature Extra Virgin Olive Oil" → "olive oil"
- "T-bone steak USDA choice" → "steak"
- "Blue Diamond Almond Breeze Unsweetened" → "almond milk"

Item: "${name}"`,
      }],
    });

    const normalized = (object as { normalized: string }).normalized || name;
    normalizeCache.set(name, { normalized, expiresAt: Date.now() + CACHE_TTL });
    return normalized;
  } catch {
    return name;
  }
}
