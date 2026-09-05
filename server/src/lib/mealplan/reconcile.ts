/**
 * Deterministic have-vs-buy reconciliation (plan §2.3, §11.1).
 *
 * The LLM is NEVER asked whether an ingredient is in the pantry. After generation,
 * this module normalizes each ingredient name in code and matches it against a
 * normalized pantry index built once per call — presence-based, no unit arithmetic,
 * because `items.unit` is free text and `items.quantity` has no consistent semantic
 * across rows (plan §1, constraint 2).
 *
 * Pure and synchronous: no DB, no network, no `new Date()`. `matchIngredient` /
 * `buildPantryIndex` are exported so a future tier-4 (Postgres `pg_trgm
 * similarity()`) fallback can be layered on top without touching this file's logic —
 * that tier is a DB concern and is intentionally not implemented here. (Tier 3, added
 * below, is the cut/form-word "core" match — still pure/local, not DB-backed.)
 */

import { normalizeIngredientName, isStaple, CUT_FORM_WORDS } from "../ingredients";
import type { PantryItem } from "./prompt";

// ---------------------------------------------------------------------------------
// Pantry index — built ONCE per generation, not per ingredient. This is what keeps
// reconciliation from being O(n·m) across 5000 pantry items x up to 56 meals: each
// ingredient lookup below is an O(1)-average map lookup, not a linear scan.
// ---------------------------------------------------------------------------------

interface PantryIndexEntry {
  id: string;
  normalizedName: string;
  tokens: string[];
  quantity: number;
}

export interface PantryIndex {
  /** normalizedName -> every pantry entry with that exact name (tier 1). */
  readonly byExactName: ReadonlyMap<string, PantryIndexEntry[]>;
  /**
   * Last token ("head noun") -> every pantry entry whose normalized name ends with
   * that token (tier 2 candidate set). Indexing by the LAST token, rather than every
   * token, is what makes tier-2 matching direction-aware: "milk" (last token "milk")
   * only ever looks at entries that also end in "milk", never at "milk chocolate"
   * (last token "chocolate").
   */
  readonly byLastToken: ReadonlyMap<string, PantryIndexEntry[]>;
  /**
   * Last token of a pantry entry's CUT/FORM-stripped "core" -> every entry whose
   * normalized name's actual tail is a curated cut/form word (breast, fillet, loaf,
   * block, ...; see `CUT_FORM_WORDS` in `ingredients.ts`), bucketed under the last
   * token of what's LEFT after stripping that word (tier 3 candidate set). This is
   * what lets "chicken" reach a pantry entry named "Chicken Breast" — tail-anchored
   * tier 2 alone never would, since "chicken" isn't the tail of "chicken breast",
   * "breast" is — while still costing only an O(1)-average map lookup, not a scan.
   * Entries with nothing to strip (e.g. plain "onion") are never added here; they're
   * already fully reachable via `byExactName`/`byLastToken`.
   */
  readonly byCutWordCoreLastToken: ReadonlyMap<string, CutWordCandidate[]>;
}

interface CutWordCandidate {
  entry: PantryIndexEntry;
  /**
   * `entry.tokens` with its trailing run of curated cut/form words removed, e.g.
   * `["chicken", "breast"]` -> `["chicken"]`. This is the "food-bearing prefix" an
   * ingredient is actually matched against for tier 3, never the full `entry.tokens`.
   */
  coreTokens: string[];
}

/**
 * Strips a trailing run of curated cut/form words (see `CUT_FORM_WORDS`) off a
 * pantry entry's tokens, always leaving at least one token — a pantry item literally
 * named "Breast" stays `["breast"]` rather than being stripped to nothing. Chains
 * (e.g. a hypothetical "chicken breast fillet") strip more than one trailing word.
 */
function stripTrailingCutWords(tokens: readonly string[]): string[] {
  const core = [...tokens];
  while (core.length > 1 && CUT_FORM_WORDS.has(core[core.length - 1]!)) {
    core.pop();
  }
  return core;
}

/**
 * Builds the normalized pantry index used by {@link matchIngredient}. Call this ONCE
 * per plan-generation/reconciliation, then reuse the returned index for every
 * ingredient — never rebuild it per ingredient.
 */
export function buildPantryIndex(items: readonly PantryItem[]): PantryIndex {
  const byExactName = new Map<string, PantryIndexEntry[]>();
  const byLastToken = new Map<string, PantryIndexEntry[]>();
  const byCutWordCoreLastToken = new Map<string, CutWordCandidate[]>();

  for (const item of items) {
    const normalizedName = normalizeIngredientName(item.name);
    if (!normalizedName) continue;

    const entry: PantryIndexEntry = {
      id: item.id,
      normalizedName,
      tokens: normalizedName.split(" "),
      quantity: item.quantity,
    };

    const exactBucket = byExactName.get(normalizedName);
    if (exactBucket) exactBucket.push(entry);
    else byExactName.set(normalizedName, [entry]);

    const lastToken = entry.tokens[entry.tokens.length - 1]!;
    const tokenBucket = byLastToken.get(lastToken);
    if (tokenBucket) tokenBucket.push(entry);
    else byLastToken.set(lastToken, [entry]);

    // Tier 3: only populated when the entry's ACTUAL tail is a curated cut/form word
    // — i.e. stripping did something. An entry like plain "onion" has coreTokens ===
    // tokens (nothing to strip) and is deliberately left out of this map entirely;
    // it's already fully reachable via byExactName/byLastToken.
    const coreTokens = stripTrailingCutWords(entry.tokens);
    if (coreTokens.length < entry.tokens.length) {
      const coreLastToken = coreTokens[coreTokens.length - 1]!;
      const candidate: CutWordCandidate = { entry, coreTokens };
      const cutWordBucket = byCutWordCoreLastToken.get(coreLastToken);
      if (cutWordBucket) cutWordBucket.push(candidate);
      else byCutWordCoreLastToken.set(coreLastToken, [candidate]);
    }
  }

  return { byExactName, byLastToken, byCutWordCoreLastToken };
}

/**
 * True if `shorter`'s tokens equal the trailing (rightmost) tokens of `longer`, i.e.
 * `longer` "ends with" `shorter` at word boundaries. This is a head-noun-anchored
 * containment check: English food noun phrases are head-final ("whole milk", "yellow
 * onion"), so requiring a match on the tail — not just "any shared token" — is what
 * lets "milk" match "whole milk" (tail = ["milk"]) while correctly refusing to match
 * "milk chocolate" (tail = ["chocolate"]): a plain "does ingredient's token appear
 * anywhere in pantry item's tokens" check would wrongly match both.
 */
function tailContains(shorter: readonly string[], longer: readonly string[]): boolean {
  if (shorter.length === 0 || shorter.length > longer.length) return false;
  const offset = longer.length - shorter.length;
  for (let i = 0; i < shorter.length; i++) {
    if (longer[offset + i] !== shorter[i]) return false;
  }
  return true;
}

function isWholeTokenContainment(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === b.length) return false; // equal-length non-identical is a miss, not a containment
  return a.length < b.length ? tailContains(a, b) : tailContains(b, a);
}

/**
 * Like {@link isWholeTokenContainment}, but — unlike that function — does NOT reject
 * equal-length inputs. Used only for tier 3 (cut-word core matching), where the
 * comparison is against a pantry entry's STRIPPED core rather than its full name, so
 * an equal-length-and-identical pair (e.g. ingredient `["cheddar", "cheese"]` vs. the
 * core of "Cheddar Cheese Block", also `["cheddar", "cheese"]`) is a genuine new match
 * that tier 1 never tried (tier 1 compares against the full name, cut word included).
 * `tailContains` with equal-length inputs already reduces to element-wise equality
 * (offset 0), so this is exactly "equal, or one is a tail-anchored containment of the
 * other."
 */
function coreTokensMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.length <= b.length ? tailContains(a, b) : tailContains(b, a);
}

export interface MatchResult {
  matched: boolean;
  /**
   * 1.0 = exact normalized equality, 0.8 = whole-token containment (tier 2), 0.7 =
   * cut/form-word core match (tier 3), 0 = no match. Tier 3 is scored below tier 2
   * because it depends on an extra assumption tier 2 doesn't: that the curated
   * `CUT_FORM_WORDS` list is right that the stripped tail word never changes the
   * food's identity. That's true for "chicken breast" -> "chicken", but a curated
   * list is inherently an approximation (see reconcile.test.ts for the edge cases
   * this was weighed against), so it's priced as a slightly weaker signal than a pure
   * token-boundary containment check.
   */
  confidence: number;
  entry: PantryIndexEntry | null;
}

/** Confidence for a tier-3 cut/form-word core match; see {@link MatchResult}. */
const CUT_WORD_CORE_CONFIDENCE = 0.7;

/**
 * Matches a normalized ingredient name against the pantry index. First hit wins:
 * exact normalized equality (1.0, tier 1) -> whole-token containment either direction
 * (0.8, tier 2) -> cut/form-word core match either direction (0.7, tier 3) -> miss.
 * (Trigram similarity is tier 4, a Postgres `pg_trgm` concern — deliberately not
 * implemented here; see the module doc comment.)
 *
 * When multiple pantry rows share a name or match by containment at the same tier,
 * prefers one with `quantity > 0` so a single depleted duplicate doesn't shadow a
 * usable one.
 */
export function matchIngredient(normalizedIngredientName: string, index: PantryIndex): MatchResult {
  if (!normalizedIngredientName) return { matched: false, confidence: 0, entry: null };

  const exactEntries = index.byExactName.get(normalizedIngredientName);
  if (exactEntries && exactEntries.length > 0) {
    const best = exactEntries.find((e) => e.quantity > 0) ?? exactEntries[0]!;
    return { matched: true, confidence: 1.0, entry: best };
  }

  const ingredientTokens = normalizedIngredientName.split(" ");
  const lastToken = ingredientTokens[ingredientTokens.length - 1]!;

  const candidates = index.byLastToken.get(lastToken);
  if (candidates) {
    let best: PantryIndexEntry | null = null;
    for (const candidate of candidates) {
      if (!isWholeTokenContainment(ingredientTokens, candidate.tokens)) continue;
      if (!best || (candidate.quantity > 0 && best.quantity <= 0)) best = candidate;
    }
    if (best) return { matched: true, confidence: 0.8, entry: best };
  }

  const cutWordCandidates = index.byCutWordCoreLastToken.get(lastToken);
  if (cutWordCandidates) {
    let best: PantryIndexEntry | null = null;
    for (const candidate of cutWordCandidates) {
      if (!coreTokensMatch(ingredientTokens, candidate.coreTokens)) continue;
      if (!best || (candidate.entry.quantity > 0 && best.quantity <= 0)) best = candidate.entry;
    }
    if (best) return { matched: true, confidence: CUT_WORD_CORE_CONFIDENCE, entry: best };
  }

  return { matched: false, confidence: 0, entry: null };
}

// ---------------------------------------------------------------------------------
// Per-occurrence reconciliation + raw_text construction.
// ---------------------------------------------------------------------------------

export type IngredientSource = "pantry" | "purchase" | "staple";

/** A single ingredient line as returned by the phase-2 LLM call for one meal. */
export interface GeneratedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  preparation: string | null;
  optional: boolean;
}

/** Where a generated ingredient occurrence came from, for aggregation provenance. */
export interface IngredientOccurrence {
  dayIndex: number;
  mealId: string;
  mealTitle: string;
  ingredient: GeneratedIngredient;
}

function formatQuantityForDisplay(quantity: number): string {
  if (Number.isInteger(quantity)) return String(quantity);
  // Naive fraction display for common recipe amounts; falls back to a trimmed decimal.
  const rounded = Math.round(quantity * 100) / 100;
  return String(rounded);
}

/**
 * Builds the always-displayed `raw_text` string from an ingredient's structured
 * fields, e.g. `{quantity: 2, unit: "cups", preparation: "chopped", name: "onion"}`
 * -> `"2 cups chopped onion"`. Built in code, never asked of the model directly
 * (plan §3): asking for both a display string and structured fields invites the two
 * to disagree.
 */
export function buildRawText(ingredient: GeneratedIngredient): string {
  const segments = [
    ingredient.quantity !== null ? formatQuantityForDisplay(ingredient.quantity) : null,
    ingredient.unit,
    ingredient.preparation,
    ingredient.name,
  ].filter((s): s is string => Boolean(s && s.trim().length > 0));

  return segments.join(" ").replace(/\s+/g, " ").trim();
}

export interface ReconciledIngredient {
  dayIndex: number;
  mealId: string;
  mealTitle: string;
  rawText: string;
  nameNormalized: string;
  quantity: number | null;
  unit: string | null;
  preparation: string | null;
  optional: boolean;
  source: IngredientSource;
  matchedItemId: string | null;
  matchConfidence: number | null;
}

export interface UsedOnRef {
  dayIndex: number;
  mealId: string;
  mealTitle: string;
}

export interface AggregatedBuyItem {
  nameNormalized: string;
  source: IngredientSource;
  matchedItemId: string | null;
  matchConfidence: number | null;
  /**
   * Human-readable summed quantity, e.g. `"2 cups"` or, when the same ingredient is
   * needed in incompatible units across meals, the segments joined with " + " (e.g.
   * `"2 cups + 1 unit"`) — never a fabricated unit conversion (plan §1 constraint 2,
   * §5.4).
   */
  quantityDisplay: string;
  /** True only if every occurrence of this ingredient across the plan was optional. */
  optional: boolean;
  usedOn: UsedOnRef[];
}

export interface ReconcilePlanResult {
  /** One row per original ingredient occurrence — matches `meal_plan_ingredients` grain. */
  ingredients: ReconciledIngredient[];
  /** One row per distinct ingredient name that needs buying, aggregated across the whole plan. */
  buyList: AggregatedBuyItem[];
}

/**
 * Classifies a normalized ingredient name as `pantry` / `purchase` / `staple` given a
 * pantry-index match result. Exported so callers that need to re-derive eligibility
 * against LIVE inventory at a later time (e.g. the shopping-list commit route, plan
 * §4.4) can reuse this exact classification instead of writing a second matcher —
 * `matchIngredient`/`buildPantryIndex` plus this function is the whole have/buy
 * decision (plan §2.3).
 */
export function classifySource(normalizedName: string, match: MatchResult): IngredientSource {
  // Staples are never added to the shopping list regardless of pantry/match status
  // (plan §2.3) — checked first so it always wins over a "purchase" fallback.
  if (isStaple(normalizedName)) return "staple";
  if (match.matched && match.entry && match.entry.quantity > 0) return "pantry";
  return "purchase"; // covers both a miss and a match with quantity === 0 (treated as absent)
}

interface UnitBucket {
  unit: string | null;
  quantity: number;
  hasQuantity: boolean;
}

interface AggregateGroup {
  normalizedName: string;
  unitBuckets: Map<string, UnitBucket>;
  usedOn: UsedOnRef[];
  allOptional: boolean;
  occurrenceIndexes: number[];
}

function unitKey(unit: string | null): string {
  return unit ?? "";
}

function formatUnitBucket(bucket: UnitBucket): string {
  const qty = bucket.hasQuantity ? formatQuantityForDisplay(bucket.quantity) : "";
  const unitLabel = bucket.unit ?? "unit";
  return qty ? `${qty} ${unitLabel}` : unitLabel;
}

function formatQuantityDisplay(group: AggregateGroup): string {
  const buckets = Array.from(group.unitBuckets.values()).filter((b) => b.hasQuantity);
  if (buckets.length === 0) return "";
  // Deterministic order: by the SAME label used for display ("unit" for a null unit,
  // not ""), so output is stable regardless of encounter order — e.g. "cups" sorts
  // before the generic "unit" bucket, giving "2 cups + 1 unit" rather than the
  // reverse.
  buckets.sort((a, b) => (a.unit ?? "unit").localeCompare(b.unit ?? "unit"));
  return buckets.map(formatUnitBucket).join(" + ");
}

/**
 * Reconciles a full plan's generated ingredients against the household pantry
 * (plan §2.3, §5.4, §11.1).
 *
 * Ingredients are grouped by normalized name FIRST (aggregating quantities across
 * every meal/day they appear in — an ingredient used at both breakfast and dinner on
 * the same day aggregates into one entry, not two, per plan §11.1), and each group is
 * matched against the pantry and classified into have/buy/staple exactly ONCE. Only
 * after that does per-occurrence output get built, so every occurrence of "onion"
 * across the week reports the same source/match — and the buy list is never
 * double-counted by aggregating after per-occurrence classification instead of
 * before it.
 */
export function reconcilePlan(
  occurrences: readonly IngredientOccurrence[],
  pantryItems: readonly PantryItem[]
): ReconcilePlanResult {
  const index = buildPantryIndex(pantryItems);

  const groups = new Map<string, AggregateGroup>();

  occurrences.forEach((occ, i) => {
    const normalizedName = normalizeIngredientName(occ.ingredient.name);
    if (!normalizedName) return;

    let group = groups.get(normalizedName);
    if (!group) {
      group = {
        normalizedName,
        unitBuckets: new Map(),
        usedOn: [],
        allOptional: true,
        occurrenceIndexes: [],
      };
      groups.set(normalizedName, group);
    }

    group.usedOn.push({ dayIndex: occ.dayIndex, mealId: occ.mealId, mealTitle: occ.mealTitle });
    if (!occ.ingredient.optional) group.allOptional = false;
    group.occurrenceIndexes.push(i);

    const key = unitKey(occ.ingredient.unit);
    let bucket = group.unitBuckets.get(key);
    if (!bucket) {
      bucket = { unit: occ.ingredient.unit, quantity: 0, hasQuantity: false };
      group.unitBuckets.set(key, bucket);
    }
    if (occ.ingredient.quantity !== null) {
      bucket.quantity += occ.ingredient.quantity;
      bucket.hasQuantity = true;
    }
  });

  // Classify each group exactly once.
  const classifications = new Map<
    string,
    { source: IngredientSource; matchedItemId: string | null; matchConfidence: number | null }
  >();
  for (const normalizedName of groups.keys()) {
    const match = matchIngredient(normalizedName, index);
    classifications.set(normalizedName, {
      source: classifySource(normalizedName, match),
      matchedItemId: match.entry?.id ?? null,
      matchConfidence: match.matched ? match.confidence : null,
    });
  }

  // Per-occurrence rows, reusing the group's classification.
  const ingredients: ReconciledIngredient[] = occurrences.map((occ) => {
    const normalizedName = normalizeIngredientName(occ.ingredient.name);
    const classification = classifications.get(normalizedName) ?? {
      source: "purchase" as const,
      matchedItemId: null,
      matchConfidence: null,
    };
    return {
      dayIndex: occ.dayIndex,
      mealId: occ.mealId,
      mealTitle: occ.mealTitle,
      rawText: buildRawText(occ.ingredient),
      nameNormalized: normalizedName,
      quantity: occ.ingredient.quantity,
      unit: occ.ingredient.unit,
      preparation: occ.ingredient.preparation,
      optional: occ.ingredient.optional,
      source: classification.source,
      matchedItemId: classification.matchedItemId,
      matchConfidence: classification.matchConfidence,
    };
  });

  // Buy list: only groups classified "purchase", one aggregated row each.
  const buyList: AggregatedBuyItem[] = [];
  for (const [normalizedName, group] of groups) {
    const classification = classifications.get(normalizedName)!;
    if (classification.source !== "purchase") continue;
    buyList.push({
      nameNormalized: normalizedName,
      source: classification.source,
      matchedItemId: classification.matchedItemId,
      matchConfidence: classification.matchConfidence,
      quantityDisplay: formatQuantityDisplay(group),
      optional: group.allOptional,
      usedOn: group.usedOn,
    });
  }
  buyList.sort((a, b) => a.nameNormalized.localeCompare(b.nameNormalized));

  return { ingredients, buyList };
}
