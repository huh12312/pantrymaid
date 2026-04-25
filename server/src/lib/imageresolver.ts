import { db } from "./db";
import { items as itemsTable } from "../db/schema";
import { eq } from "drizzle-orm";
import { inferCategoryFromName } from "./openfoodfacts";
import { normalizeItemName } from "./openai";

/**
 * Normalized food name → Wikipedia article title.
 * Used as the first lookup in the image resolution chain.
 * Article titles were chosen to return CC0/CC-BY licensed thumbnails
 * via the PageImages API with pilicense=free.
 */
const SEED_MAP: Record<string, string> = {
  // Fruit
  apple: "Apple",
  banana: "Banana",
  orange: "Orange_(fruit)",
  lemon: "Lemon",
  lime: "Lime_(fruit)",
  grape: "Grape",
  strawberry: "Strawberry",
  blueberry: "Blueberry",
  raspberry: "Raspberry",
  avocado: "Avocado",
  mango: "Mango",
  peach: "Peach",
  pear: "Pear",
  pineapple: "Pineapple",
  watermelon: "Watermelon",
  // Vegetables
  tomato: "Tomato",
  carrot: "Carrot",
  broccoli: "Broccoli",
  spinach: "Spinach",
  potato: "Potato",
  "sweet potato": "Sweet_potato",
  onion: "Onion",
  garlic: "Garlic",
  "bell pepper": "Bell_pepper",
  pepper: "Capsicum",
  cucumber: "Cucumber",
  lettuce: "Lettuce",
  celery: "Celery",
  corn: "Maize",
  mushroom: "Mushroom",
  zucchini: "Zucchini",
  asparagus: "Asparagus",
  cauliflower: "Cauliflower",
  cabbage: "Cabbage",
  kale: "Kale",
  // Protein
  chicken: "Chicken_as_food",
  "chicken breast": "Chicken_as_food",
  "chicken thigh": "Chicken_as_food",
  beef: "Beef",
  "ground beef": "Ground_beef",
  pork: "Pork",
  bacon: "Bacon",
  salmon: "Salmon_as_food",
  tuna: "Tuna",
  shrimp: "Shrimp",
  egg: "Egg_as_food",
  // Dairy
  milk: "Milk",
  butter: "Butter",
  cheese: "Cheese",
  cheddar: "Cheddar_cheese",
  yogurt: "Yogurt",
  "greek yogurt": "Yogurt",
  cream: "Cream",
  // Pantry staples
  bread: "Bread",
  pasta: "Pasta",
  rice: "Rice",
  flour: "Flour",
  oat: "Oat",
  oatmeal: "Oatmeal",
  "olive oil": "Olive_oil",
  oil: "Cooking_oil",
  bean: "Bean",
  lentil: "Lentil",
  "soy sauce": "Soy_sauce",
  sugar: "Sugar",
  salt: "Salt",
  "black pepper": "Black_pepper",
  coffee: "Coffee",
  tea: "Tea",
  honey: "Honey",
  vinegar: "Vinegar",
  "peanut butter": "Peanut_butter",
  jam: "Jam",
  cereal: "Cereal",
  nuts: "Nut_(fruit)",
  almond: "Almond",
  walnut: "Walnut",
  // Beverages
  juice: "Juice",
  water: "Water",
};

const STRIP_WORDS = new Set([
  "organic", "fresh", "whole", "raw", "frozen", "canned", "sliced", "diced",
  "chopped", "baby", "large", "small", "medium", "seedless", "boneless",
  "skinless", "shredded", "grated", "minced", "peeled", "dried", "roasted",
  "salted", "unsalted", "fat-free", "low-fat", "reduced-fat", "light",
  "extra", "lean", "premium", "free-range", "cage-free", "wild-caught",
  "farm-raised", "grade", "the", "and", "or",
]);

// In-memory caches (24h TTL)
const wikiCache = new Map<string, { url: string | null; expiresAt: number }>();
const pexelsCache = new Map<string, { url: string | null; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Sorted longest-first so "chicken breast" beats "chicken" on substring checks
const SORTED_SEED_KEYS = Object.keys(SEED_MAP).sort((a, b) => b.length - a.length);

function normalizeForSeed(name: string): string {
  const words = name.toLowerCase().trim().split(/[\s,\-]+/);
  return words.filter((w) => !STRIP_WORDS.has(w) && w.length > 1).join(" ");
}

function singularize(phrase: string): string {
  return phrase.endsWith("ies")
    ? phrase.slice(0, -3) + "y"
    : phrase.endsWith("es")
      ? phrase.slice(0, -2)
      : phrase.endsWith("s")
        ? phrase.slice(0, -1)
        : phrase;
}

// Word-boundary match: key must appear as a standalone word/phrase in text,
// not as an interior substring (e.g. "tea" must not match inside "steak").
function matchesAsWord(text: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(text);
}

function lookupSeedMap(name: string): string | undefined {
  const normalized = normalizeForSeed(name);

  // 1. Exact match
  if (SEED_MAP[normalized]) return SEED_MAP[normalized];

  // 2. Singular of full phrase
  const singular = singularize(normalized);
  if (singular !== normalized && SEED_MAP[singular]) return SEED_MAP[singular];

  // 3. Word-boundary phrase match on normalized and singular (longest key wins)
  for (const key of SORTED_SEED_KEYS) {
    if (matchesAsWord(normalized, key) || matchesAsWord(singular, key)) {
      return SEED_MAP[key];
    }
  }

  // 4. First meaningful word
  const firstWord = normalized.split(" ")[0];
  if (firstWord && firstWord !== normalized) {
    if (SEED_MAP[firstWord]) return SEED_MAP[firstWord];
    const firstWordSingular = singularize(firstWord);
    if (SEED_MAP[firstWordSingular]) return SEED_MAP[firstWordSingular];
  }

  return undefined;
}

async function fetchWikipediaImage(articleTitle: string): Promise<string | null> {
  const cached = wikiCache.get(articleTitle);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.url;
  }

  const cache = (url: string | null) => {
    wikiCache.set(articleTitle, { url, expiresAt: Date.now() + CACHE_TTL_MS });
    return url;
  };

  try {
    const params = new URLSearchParams({
      action: "query",
      prop: "pageimages",
      pilicense: "free",
      pithumbsize: "400",
      titles: articleTitle,
      format: "json",
      origin: "*",
    });

    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": "PantryRadar/1.0 (chris@thebrutus.org)" },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return cache(null);

    const data = (await res.json()) as {
      query?: { pages?: Record<string, { thumbnail?: { source: string } }> };
    };

    const pages = data.query?.pages;
    if (!pages) return cache(null);

    const url = Object.values(pages)[0]?.thumbnail?.source ?? null;
    return cache(url);
  } catch {
    return cache(null);
  }
}

async function patchItem(
  itemId: string,
  fields: { imageUrl?: string; category?: string },
): Promise<void> {
  await db
    .update(itemsTable)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(itemsTable.id, itemId));
}

// Derive a short, clean search query from a raw item name.
// Strips modifiers, numbers, units, and brand-ish tokens so the Pexels
// query stays food-focused (e.g. "Heinz Original Ketchup 24oz" → "ketchup").
function pexelsQuery(name: string): string {
  const UNITS = new Set(["oz", "lb", "lbs", "kg", "g", "ml", "l", "ct", "pk", "fl"]);
  const words = name
    .toLowerCase()
    .trim()
    .split(/[\s,\-]+/)
    .filter((w) => !STRIP_WORDS.has(w) && !UNITS.has(w) && !/^\d/.test(w) && w.length > 1);
  // First 3 words are enough for a focused Pexels search
  return words.slice(0, 3).join(" ");
}

async function fetchPexelsImage(query: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  const cached = pexelsCache.get(query);
  if (cached && Date.now() < cached.expiresAt) return cached.url;

  const cache = (url: string | null) => {
    pexelsCache.set(query, { url, expiresAt: Date.now() + CACHE_TTL_MS });
    return url;
  };

  try {
    const params = new URLSearchParams({ query, per_page: "1", orientation: "square" });
    const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return cache(null);

    const data = (await res.json()) as {
      photos?: Array<{ src: { medium: string } }>;
    };

    const url = data.photos?.[0]?.src.medium ?? null;
    return cache(url);
  } catch {
    return cache(null);
  }
}

/**
 * Resolves an image URL and infers a category for a newly created item,
 * writing both back to the DB in a single update.
 * Designed to be called fire-and-forget after item creation returns to the client.
 *
 * Image fallback chain:
 *   1. Skip if imageUrl already set (barcode scan with OFF image)
 *   2. Seed map → Wikipedia PageImages API (CC-licensed only)
 *   3. Pexels stock photo search by normalized item name
 *
 * Category inference:
 *   - Skipped if category already set
 *   - Keyword match against CATEGORY_PATTERNS from openfoodfacts.ts
 */
export async function resolveImageForItem(
  itemId: string,
  name: string,
  _barcodeUpc: string | null,
  existingImageUrl: string | null,
  existingCategory: string | null,
): Promise<void> {
  const patch: { imageUrl?: string; category?: string } = {};

  // Infer category if not already set
  if (!existingCategory) {
    const inferred = inferCategoryFromName(name);
    if (inferred) patch.category = inferred;
  }

  // Resolve image if not already set
  if (!existingImageUrl) {
    // Step 1: seed map on raw name → Wikipedia
    const rawTitle = lookupSeedMap(name);
    const wikiUrl = rawTitle ? await fetchWikipediaImage(rawTitle) : null;

    if (wikiUrl) {
      patch.imageUrl = wikiUrl;
    } else {
      // Step 2: LLM normalization → retry seed map → Wikipedia
      const normalized = await normalizeItemName(name);
      let resolvedUrl: string | null = null;

      if (normalized !== name) {
        const normalizedTitle = lookupSeedMap(normalized);
        resolvedUrl = normalizedTitle ? await fetchWikipediaImage(normalizedTitle) : null;
      }

      // Step 3: Pexels with best available query
      if (!resolvedUrl) {
        const query = pexelsQuery(normalized !== name ? normalized : name);
        if (query) resolvedUrl = await fetchPexelsImage(query);
      }

      if (resolvedUrl) patch.imageUrl = resolvedUrl;
    }
  }

  if (Object.keys(patch).length > 0) {
    await patchItem(itemId, patch);
  }
}
