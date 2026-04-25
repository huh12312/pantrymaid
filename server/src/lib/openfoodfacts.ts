/**
 * Open Food Facts API client
 * Free product database - no API key required
 * With product_cache layer and fuzzy search
 */

import { db } from "./db";
import { productCache } from "../db/schema";
import { eq } from "drizzle-orm";

export interface OpenFoodFactsProduct {
  code: string;
  product_name?: string;
  brands?: string;
  categories?: string;
  image_url?: string;
}

interface OpenFoodFactsResponse {
  status: number;
  product?: OpenFoodFactsProduct;
}

interface OpenFoodFactsSearchResponse {
  products?: OpenFoodFactsProduct[];
}

export interface ProductCacheEntry {
  upc: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  source: string;
  fetchedAt: Date;
}

export interface FuzzyMatch {
  product: OpenFoodFactsProduct;
  confidence: number;
}

// Cache TTL: 7 days
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Keyword patterns mapped to FOOD_CATEGORIES (from packages/shared/src/constants).
 * OFF taxonomy tags look like "en:dairy-products", "en:cheeses", etc.
 * Checked in priority order — first match wins.
 */
const CATEGORY_PATTERNS: Array<{ keywords: string[]; category: string }> = [
  { keywords: ["frozen"], category: "Frozen Foods" },
  { keywords: ["dairy", "milk", "cheese", "yogurt", "butter", "cream", "kefir"], category: "Dairy" },
  { keywords: [
    "meat", "beef", "pork", "chicken", "poultry", "lamb", "veal", "turkey", "sausage", "bacon", "deli",
    "steak", "ribs", "brisket", "sirloin", "tenderloin", "drumstick", "cutlet", "meatball", "mince", "roast",
  ], category: "Meat & Poultry" },
  { keywords: [
    "seafood", "fish", "shrimp", "salmon", "tuna", "shellfish", "crab", "lobster",
    "cod", "tilapia", "halibut", "scallop", "mussel", "oyster", "anchovy", "sardine",
  ], category: "Seafood" },
  { keywords: [
    "fruit", "vegetable", "produce", "salad", "herb", "mushroom", "potato", "tomato",
    "onion", "carrot", "pepper", "berry",
    // specific fruits
    "apple", "banana", "orange", "lemon", "lime", "grape", "mango", "peach", "pear",
    "plum", "kiwi", "avocado", "watermelon", "pineapple", "melon", "cherry", "cherries",
    "blueberry", "blueberries", "strawberry", "strawberries", "raspberry", "raspberries",
    "cranberry", "cranberries", "blackberry", "blackberries", "gooseberry",
    // specific vegetables
    "broccoli", "spinach", "kale", "celery", "cucumber", "lettuce", "asparagus",
    "cauliflower", "zucchini", "squash", "beet", "radish", "leek", "arugula",
    "cabbage", "chard", "fennel", "artichoke", "eggplant", "aubergine", "parsnip",
  ], category: "Produce" },
  { keywords: [
    "bread", "bakery", "baked", "roll", "bun", "tortilla", "wrap", "bagel", "muffin",
    "pastry", "cake", "donut", "croissant", "sourdough", "loaf", "brioche", "focaccia", "pita",
  ], category: "Bread & Bakery" },
  { keywords: [
    "pasta", "rice", "grain", "cereal", "oat", "flour", "noodle", "quinoa", "barley",
    "lentil", "bean", "legume", "couscous", "bulgur", "farro", "polenta", "grits",
  ], category: "Grains & Pasta" },
  { keywords: ["canned", "tinned", "preserved", "jar"], category: "Canned Goods" },
  { keywords: [
    "condiment", "sauce", "dressing", "ketchup", "mustard", "mayonnaise", "vinegar",
    "oil", "syrup", "spread", "jam", "jelly",
    "sriracha", "tabasco", "salsa", "pesto", "hummus", "aioli", "relish", "tahini",
    "chutney", "glaze", "marinade", "gravy", "hoisin", "teriyaki",
  ], category: "Condiments & Sauces" },
  { keywords: [
    "snack", "chip", "crisp", "cracker", "cookie", "biscuit", "popcorn", "pretzel",
    "nut", "candy", "chocolate", "sweet", "dessert",
    "granola", "jerky", "pork rind", "rice cake", "trail mix",
  ], category: "Snacks" },
  { keywords: [
    "beverage", "drink", "juice", "water", "soda", "coffee", "tea", "beer", "wine",
    "alcohol", "energy-drink", "smoothie", "kombucha", "cider", "lemonade", "espresso",
  ], category: "Beverages" },
  { keywords: [
    "spice", "seasoning", "salt", "pepper", "cinnamon", "cumin", "paprika", "oregano",
    "basil", "garlic-powder", "turmeric", "ginger", "rosemary", "thyme", "chili",
    "cayenne", "clove", "nutmeg", "cardamom", "curry", "bay leaf", "anise",
  ], category: "Spices & Seasonings" },
];

/**
 * Normalize a raw Open Food Facts categories string to one of the app's FOOD_CATEGORIES.
 * Returns null if the input is empty; falls back to "Other" if no pattern matches.
 *
 * OFF sends a comma-separated list of taxonomy tags ordered from most general to most
 * specific, e.g. "en:dairy-products, en:cheeses, en:soft-cheeses, en:brie".
 * We scan all tags (preferring the more specific end) and pick the first match.
 */
/**
 * Infer a FOOD_CATEGORY from a plain item name (e.g. "t-bone steak" → "Meat & Poultry").
 * Uses word-boundary matching so "pepper" doesn't fire inside "peppercorn".
 * Returns null if no pattern matches (caller can decide on a fallback).
 */
export function inferCategoryFromName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const { keywords, category } of CATEGORY_PATTERNS) {
    if (
      keywords.some((kw) => {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?:^|[\\s\\-,])${escaped}(?:[\\s\\-,]|$)`).test(lower);
      })
    ) {
      return category;
    }
  }
  return null;
}

export function normalizeCategoryFromOff(offCategories: string | null): string | null {
  if (!offCategories) return null;

  // Split, strip language prefix, lowercase — "en:breakfast-cereals" → "breakfast-cereals"
  const tags = offCategories
    .split(",")
    .map((t) => t.trim().replace(/^[a-z]{2}:/, "").toLowerCase());

  // Check from most specific (last) to most general (first)
  for (const tag of [...tags].reverse()) {
    for (const { keywords, category } of CATEGORY_PATTERNS) {
      if (keywords.some((kw) => tag.includes(kw))) {
        return category;
      }
    }
  }

  return "Other";
}

export class OpenFoodFactsClient {
  private baseUrl = "https://world.openfoodfacts.org/api/v2";

  /**
   * Look up a product by UPC/barcode
   * Checks cache first, then fetches from API if needed
   */
  async getProductByBarcode(upc: string): Promise<ProductCacheEntry | null> {
    // Check cache first
    const cached = await this.getCachedProduct(upc);
    if (cached && !this.isCacheStale(cached.fetchedAt)) {
      return cached;
    }

    // Cache miss or stale - fetch from API
    const product = await this.fetchProductByBarcode(upc);
    if (!product) {
      return null;
    }

    // Store in cache
    const cacheEntry = await this.cacheProduct(product);
    return cacheEntry;
  }

  /**
   * Fuzzy search by product name
   * Returns top 3 matches with confidence scores
   */
  async fuzzySearch(name: string): Promise<FuzzyMatch[]> {
    const products = await this.searchProducts(name, 10);

    // Calculate confidence based on string similarity
    const matches = products.map((product) => ({
      product,
      confidence: this.calculateSimilarity(
        name.toLowerCase(),
        (product.product_name || "").toLowerCase()
      ),
    }));

    // Sort by confidence and return top 3
    return matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
      .filter((match) => match.confidence > 0.3); // Filter out low-confidence matches
  }

  /**
   * Search for products by name (direct API call)
   */
  async searchProducts(
    query: string,
    limit = 10
  ): Promise<OpenFoodFactsProduct[]> {
    const url = `${this.baseUrl}/search?search_terms=${encodeURIComponent(query)}&page_size=${limit}&json=true`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "PantryRadar/1.0 (https://github.com/huh12312/pantryradar)",
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as OpenFoodFactsSearchResponse;
      return data.products || [];
    } catch (error) {
      console.error("Open Food Facts search error:", error);
      return [];
    }
  }

  /**
   * Get cached product from database
   */
  private async getCachedProduct(
    upc: string
  ): Promise<ProductCacheEntry | null> {
    try {
      const [cached] = await db
        .select()
        .from(productCache)
        .where(eq(productCache.upc, upc));

      return cached || null;
    } catch (error) {
      console.error("Error reading from product cache:", error);
      return null;
    }
  }

  /**
   * Check if cache entry is stale (older than TTL)
   */
  private isCacheStale(fetchedAt: Date): boolean {
    return Date.now() - fetchedAt.getTime() > CACHE_TTL_MS;
  }

  /**
   * Fetch product from Open Food Facts API
   */
  private async fetchProductByBarcode(
    upc: string
  ): Promise<OpenFoodFactsProduct | null> {
    const url = `${this.baseUrl}/product/${upc}.json`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "PantryRadar/1.0 (https://github.com/huh12312/pantryradar)",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as OpenFoodFactsResponse;

      if (data.status === 1 && data.product) {
        return data.product;
      }

      return null;
    } catch (error) {
      console.error("Open Food Facts API error:", error);
      return null;
    }
  }

  /**
   * Cache a product in the database
   */
  private async cacheProduct(
    product: OpenFoodFactsProduct
  ): Promise<ProductCacheEntry> {
    const entry: ProductCacheEntry = {
      upc: product.code,
      name: product.product_name || null,
      brand: product.brands || null,
      category: product.categories || null,
      imageUrl: product.image_url || null,
      source: "open_food_facts",
      fetchedAt: new Date(),
    };

    try {
      await db
        .insert(productCache)
        .values(entry)
        .onConflictDoUpdate({
          target: productCache.upc,
          set: {
            name: entry.name,
            brand: entry.brand,
            category: entry.category,
            imageUrl: entry.imageUrl,
            fetchedAt: entry.fetchedAt,
          },
        });
    } catch (error) {
      console.error("Error caching product:", error);
    }

    return entry;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   * Returns a value between 0 and 1 (1 = identical)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    // Check for substring match (higher confidence)
    if (longer.includes(shorter)) {
      return 0.8 + 0.2 * (shorter.length / longer.length);
    }

    const distance = this.levenshteinDistance(str1, str2);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2[i - 1] === str1[j - 1]) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1, // substitution
            matrix[i]![j - 1]! + 1, // insertion
            matrix[i - 1]![j]! + 1 // deletion
          );
        }
      }
    }

    return matrix[str2.length]![str1.length]!;
  }
}

// Export singleton instance
export const openFoodFactsClient = new OpenFoodFactsClient();
