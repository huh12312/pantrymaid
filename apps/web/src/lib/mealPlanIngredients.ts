/**
 * The needs-purchase surface's aggregation engine (plan §5.4). PURE — no I/O, no React,
 * no query cache. Everything here is computed fresh from two live inputs the caller
 * already has in hand: a meal plan's nested days/meals/ingredients, and the current
 * inventory list. That is deliberate (plan §5.8, the "CRITICAL cache rule"): have/buy
 * status is NEVER cached as its own entity. The caller (`MealPlanPage`) wraps
 * `aggregateMealPlanIngredients` in a single `useMemo` keyed on `[plan, inventory]`, so
 * every existing inventory invalidation (`useInventoryMutations.ts`) refreshes this
 * surface for free — no new invalidation wiring anywhere.
 *
 * Grouping: ingredients are bucketed by `${nameNormalized}::${unit}` first (so
 * same-unit quantities can be summed honestly), then those buckets are merged into one
 * display row per `nameNormalized` — mixed-unit buckets join into a single
 * human-readable string ("2 cups + 1 unit") instead of a fabricated conversion, because
 * `items.unit`/ingredient `unit` are free text with no consistent semantic (plan §1).
 */
import type { InventoryItem, MealPlanIngredient } from "@/lib/api";
import { parseLocalDate, describeExpiry } from "@/lib/dates";
import { formatMealPlanDayHeading } from "@/lib/mealPlanControls";

export type IngredientPurchaseStatus = "have" | "have_expiring" | "must_buy";

/** One meal that contributed to an aggregate — provenance for the "why is this here" chip. */
export interface MealPlanIngredientUsage {
  dayIndex: number;
  mealId: string;
  mealTitle: string;
}

export interface MealPlanIngredientAggregate {
  /** `nameNormalized` — stable, unique within one plan's aggregation; usable as a React key. */
  nameNormalized: string;
  displayName: string;
  /** Pre-formatted, e.g. "2 cups + 1 unit" or "3". Never a bare unit-less conversion. */
  quantityLabel: string;
  status: IngredientPurchaseStatus;
  /** Set only when `status === "have_expiring"` — `describeExpiry` text ("Expires in 2 days"). */
  expiryLabel: string | null;
  /** Every contributing `MealPlanIngredient.id`, across every meal/day it was used in. */
  ingredientIds: string[];
  usedOn: MealPlanIngredientUsage[];
}

export interface MealPlanIngredientsSummary {
  totalIngredients: number;
  toBuyCount: number;
}

/** Minimal shape this module needs from a meal — structurally satisfied by `MealPlanMealDetail`. */
export interface MealPlanIngredientsMealInput {
  id: string;
  title: string;
  ingredients: readonly MealPlanIngredient[];
}

/** Minimal shape this module needs from a day — structurally satisfied by `MealPlanDayDetail`. */
export interface MealPlanIngredientsDayInput {
  dayIndex: number;
  meals: readonly MealPlanIngredientsMealInput[];
}

/** Minimal shape this module needs from a plan — structurally satisfied by `MealPlanDetail`. */
export interface MealPlanIngredientsPlanInput {
  startDate: string;
  days: readonly MealPlanIngredientsDayInput[];
}

const GROUP_ORDER: readonly IngredientPurchaseStatus[] = ["must_buy", "have_expiring", "have"];

export const GROUP_LABELS: Record<IngredientPurchaseStatus, string> = {
  must_buy: "Must buy",
  have_expiring: "Expiring",
  have: "Have it",
};

// A handful of irregular plurals worth special-casing so common grocery nouns don't
// come out mangled ("tomatoes" -> "tomatoe"). Mirrors (a subset of) the server's own
// IRREGULAR_PLURALS (server/src/lib/ingredients.ts) closely enough that the same word
// normalizes to the same key on both sides — this function only ever runs on values
// the server's normalizer never touched (see the doc comment on `normalizeIngredientName`).
const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  tomatoes: "tomato",
  potatoes: "potato",
  berries: "berry",
  cherries: "cherry",
  leaves: "leaf",
  loaves: "loaf",
  knives: "knife",
  shelves: "shelf",
  halves: "half",
  wolves: "wolf",
};

// Mass nouns / words that end in "s" but are already singular — a naive trailing-"s"
// strip would otherwise mangle these into non-words. Mirrors the server's
// SINGULARIZE_EXCEPTIONS so "asparagus", "hummus", etc. survive a client-side pass too.
const SINGULARIZE_EXCEPTIONS = new Set([
  "asparagus",
  "hummus",
  "citrus",
  "molasses",
  "couscous",
  "chives",
  "greens",
  "grits",
  "oats",
  "beans", // conventionally treated as the base form for the food
  "peas", // same — "pea" reads oddly as a grocery ingredient name
  "swiss",
]);

/** Naive per-word singularization — same caveats/exceptions as the server's `singularizeToken`. */
function singularizeWord(word: string): string {
  if (word.length <= 3) return word;
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (SINGULARIZE_EXCEPTIONS.has(word)) return word;
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/oes$/.test(word)) return word.slice(0, -2);
  if (/ss$/.test(word)) return word; // "grass" etc. — don't strip the final "s"
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Lowercase, trim, strip punctuation, singularize each word's trailing "s". Deliberately
 * naive — this is NOT a general English pluralization library, just enough to fold
 * "onion" and "onions" (or "Onion." from a stray period) into one bucket.
 *
 * IMPORTANT: only call this on a value that never passed through the server's own (far
 * more careful) `normalizeIngredientName` (server/src/lib/ingredients.ts) — i.e. a bare
 * `rawText` fallback, or a live `ShoppingListItem.name` the meal-plan normalizer never
 * saw. Calling it AGAIN on an already-normalized `ingredient.nameNormalized` is exactly
 * the bug this comment used to describe: a second naive pass corrupts server-curated
 * mass nouns ("asparagus" -> "asparagu") and un-pluralizes server-intentional plurals
 * ("beans" -> "bean"). `aggregateMealPlanIngredients` below uses `nameNormalized`
 * directly for that reason.
 */
export function normalizeIngredientName(raw: string): string {
  const lowered = raw.toLowerCase().trim();
  const stripped = lowered
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  return stripped.split(" ").map(singularizeWord).join(" ");
}

function normalizeUnit(unit: string | null): string {
  return (unit ?? "").toLowerCase().trim();
}

function toDisplayName(nameNormalized: string): string {
  return nameNormalized.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "cup" x2 -> "cups"; "unit" x1 -> "unit". Naive trailing-s pluralization, same caveat as above. */
function pluralizeUnit(unit: string, quantity: number): string {
  if (quantity === 1 || unit.length === 0 || unit.endsWith("s")) return unit;
  return `${unit}s`;
}

/** Local-time date arithmetic only (never `.toISOString()`/UTC) — see `lib/dates.ts`'s own doc comment. */
function addLocalDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

interface UnitBucket {
  unit: string; // normalized; "" means unitless
  quantitySum: number;
  hasQuantity: boolean;
}

interface RowRecord {
  ingredient: MealPlanIngredient;
  dayIndex: number;
  mealId: string;
  mealTitle: string;
}

interface NameGroup {
  nameNormalized: string;
  buckets: Map<string, UnitBucket>;
  bucketOrder: string[];
  rows: RowRecord[];
}

function formatQuantityLabel(buckets: Map<string, UnitBucket>, order: string[]): string {
  const parts = order.map((unitKey) => {
    const bucket = buckets.get(unitKey);
    if (!bucket) return "";
    if (!bucket.hasQuantity) return bucket.unit || "some";
    const qty = Number.isInteger(bucket.quantitySum)
      ? String(bucket.quantitySum)
      : String(Math.round(bucket.quantitySum * 100) / 100);
    return bucket.unit ? `${qty} ${pluralizeUnit(bucket.unit, bucket.quantitySum)}` : qty;
  });
  return parts.filter(Boolean).join(" + ");
}

/**
 * Aggregates every non-staple ingredient across the whole plan into one row per
 * normalized ingredient name (plan §5.4, §11.1). `inventory` is matched live by
 * `matchedItemId`, so consuming/restocking an item on the Inventory page changes the
 * result of the very next render with zero extra wiring.
 */
export function aggregateMealPlanIngredients(
  plan: MealPlanIngredientsPlanInput,
  inventory: readonly InventoryItem[],
  now: Date = new Date()
): MealPlanIngredientAggregate[] {
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const groups = new Map<string, NameGroup>();

  for (const day of plan.days) {
    for (const meal of day.meals) {
      for (const ingredient of meal.ingredients) {
        if (ingredient.source === "staple") continue; // never appears on the buy list (plan §5.4)

        // `nameNormalized` was already normalized server-side (server/src/lib/ingredients.ts)
        // with a far more careful pipeline (compound-food allowlist, curated mass-noun
        // exceptions). Re-running the naive client normalizer over it would corrupt those
        // curated results — use it as-is. The naive normalizer only runs as a defensive
        // fallback for the (schema-disallowed, but not worth crashing over) case where
        // it's empty.
        const nameNormalized =
          ingredient.nameNormalized || normalizeIngredientName(ingredient.rawText);
        if (!nameNormalized) continue;

        let group = groups.get(nameNormalized);
        if (!group) {
          group = { nameNormalized, buckets: new Map(), bucketOrder: [], rows: [] };
          groups.set(nameNormalized, group);
        }

        const unitKey = normalizeUnit(ingredient.unit);
        let bucket = group.buckets.get(unitKey);
        if (!bucket) {
          bucket = { unit: unitKey, quantitySum: 0, hasQuantity: false };
          group.buckets.set(unitKey, bucket);
          group.bucketOrder.push(unitKey);
        }
        if (typeof ingredient.quantity === "number") {
          bucket.quantitySum += ingredient.quantity;
          bucket.hasQuantity = true;
        }

        group.rows.push({
          ingredient,
          dayIndex: day.dayIndex,
          mealId: meal.id,
          mealTitle: meal.title,
        });
      }
    }
  }

  const startParsed = parseLocalDate(plan.startDate) ?? now;
  const priority: Record<IngredientPurchaseStatus, number> = {
    must_buy: 2,
    have_expiring: 1,
    have: 0,
  };

  const aggregates: MealPlanIngredientAggregate[] = [];

  for (const group of groups.values()) {
    const lastDayIndex = group.rows.reduce((max, row) => Math.max(max, row.dayIndex), 0);
    const lastUseDate = addLocalDays(startParsed, lastDayIndex);

    let status: IngredientPurchaseStatus = "have";
    let soonestExpiringIso: string | null = null;

    const ingredientIds: string[] = [];
    const usedOnSeen = new Set<string>();
    const usedOn: MealPlanIngredientUsage[] = [];

    for (const row of group.rows) {
      ingredientIds.push(row.ingredient.id);

      const usedOnKey = `${row.dayIndex}|${row.mealId}`;
      if (!usedOnSeen.has(usedOnKey)) {
        usedOnSeen.add(usedOnKey);
        usedOn.push({ dayIndex: row.dayIndex, mealId: row.mealId, mealTitle: row.mealTitle });
      }

      const rowResult = resolveRowStatus(row.ingredient, inventoryById, lastUseDate);
      if (priority[rowResult.status] > priority[status]) status = rowResult.status;
      if (rowResult.status === "have_expiring" && rowResult.expiryIso) {
        if (!soonestExpiringIso || rowResult.expiryIso < soonestExpiringIso) {
          soonestExpiringIso = rowResult.expiryIso;
        }
      }
    }

    aggregates.push({
      nameNormalized: group.nameNormalized,
      displayName: toDisplayName(group.nameNormalized),
      quantityLabel: formatQuantityLabel(group.buckets, group.bucketOrder),
      status,
      expiryLabel:
        status === "have_expiring" && soonestExpiringIso
          ? describeExpiry(soonestExpiringIso, now)
          : null,
      ingredientIds,
      usedOn,
    });
  }

  return aggregates.sort((a, b) => a.nameNormalized.localeCompare(b.nameNormalized));
}

function resolveRowStatus(
  ingredient: MealPlanIngredient,
  inventoryById: Map<string, InventoryItem>,
  lastUseDate: Date
): { status: IngredientPurchaseStatus; expiryIso: string | null } {
  // A user's manual have<->buy flip wins over anything computed from inventory.
  if (ingredient.sourceOverridden) {
    return ingredient.source === "purchase"
      ? { status: "must_buy", expiryIso: null }
      : { status: "have", expiryIso: null };
  }

  const matched = ingredient.matchedItemId
    ? inventoryById.get(ingredient.matchedItemId)
    : undefined;
  // No match, or a matched item with zero quantity, is treated identically to "don't have it".
  if (!matched || matched.quantity === 0) {
    return { status: "must_buy", expiryIso: null };
  }

  if (!matched.expirationDate) {
    return { status: "have", expiryIso: null };
  }

  const expiryDate = parseLocalDate(matched.expirationDate);
  if (!expiryDate) return { status: "have", expiryIso: null };

  if (expiryDate.getTime() <= lastUseDate.getTime()) {
    return { status: "have_expiring", expiryIso: matched.expirationDate };
  }
  return { status: "have", expiryIso: null };
}

/** "14 ingredients · 6 to buy" — the persistent summary bar (plan §5.4). */
export function summarizeIngredientAggregates(
  aggregates: readonly MealPlanIngredientAggregate[]
): MealPlanIngredientsSummary {
  return {
    totalIngredients: aggregates.length,
    toBuyCount: aggregates.filter((a) => a.status === "must_buy").length,
  };
}

/**
 * Per-day "N to buy" counts for `DaySection`'s header (plan §5.2 SEAM). An aggregate
 * used at breakfast AND dinner on the same day contributes ONE to that day's count, not
 * two — `usedOn` dayIndexes are deduped per aggregate before counting (plan §11.1).
 */
export function toBuyCountsByDay(
  aggregates: readonly MealPlanIngredientAggregate[]
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const aggregate of aggregates) {
    if (aggregate.status !== "must_buy") continue;
    const daysSeen = new Set(aggregate.usedOn.map((u) => u.dayIndex));
    for (const dayIndex of daysSeen) {
      counts.set(dayIndex, (counts.get(dayIndex) ?? 0) + 1);
    }
  }
  return counts;
}

export interface MealPlanIngredientGroup {
  status: IngredientPurchaseStatus;
  label: string;
  items: MealPlanIngredientAggregate[];
}

/** Must buy -> Expiring -> Have it (plan §5.4), each group's items already name-sorted. */
export function groupAggregatesByStatus(
  aggregates: readonly MealPlanIngredientAggregate[]
): MealPlanIngredientGroup[] {
  return GROUP_ORDER.map((status) => ({
    status,
    label: GROUP_LABELS[status],
    items: aggregates.filter((a) => a.status === status),
  }));
}

/** "Mon · Onion Soup" — one provenance chip built from a single `usedOn` entry. */
export function formatUsedOnChip(usage: MealPlanIngredientUsage, startDate: string): string {
  const startParsed = parseLocalDate(startDate) ?? new Date();
  const date = addLocalDays(startParsed, usage.dayIndex);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
  const weekdayAbbrev = formatMealPlanDayHeading(iso).slice(0, 3);
  return `${weekdayAbbrev} · ${usage.mealTitle}`;
}
