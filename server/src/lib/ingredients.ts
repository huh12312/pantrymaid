/**
 * Pure, local ingredient-name normalizer for meal planning.
 *
 * This is deliberately NOT `normalizeItemName` from `./openai.ts` — that function is
 * an LLM round-trip, and a single generated plan can carry 60-100 distinct
 * ingredients. Calling an LLM once per ingredient would mean up to 100 extra calls
 * billed to the household's own API key just to decide have-vs-buy (see
 * docs/plans/meal-planning.md §2.3). Everything in this file is synchronous, has no
 * external dependency, and is safe to call thousands of times per request.
 *
 * No `new Date()`, no `process.env`, no I/O — matching the "pure logic" constraint
 * for the whole `lib/mealplan/*` + `lib/ingredients.ts` module group (plan §8).
 */

// ---------------------------------------------------------------------------------
// Stopwords — descriptors that don't change what the ingredient *is*. Stripped after
// the compound-food allowlist check below, so a stopword can never eat into a
// protected compound (e.g. "hot" is a stopword-adjacent word but "hot sauce" is
// matched as a compound before stopword stripping ever runs).
// ---------------------------------------------------------------------------------
const STOPWORDS = new Set([
  "organic",
  "fresh",
  "large",
  "small",
  "medium",
  "chopped",
  "diced",
  "minced",
  "boneless",
  "skinless",
  "ripe",
  "frozen",
  "canned",
  "raw",
  "cooked",
  "sliced",
  "shredded",
  "grated",
  "ground",
  "dried",
  "whole",
  "extra",
  "unsalted",
  "salted",
  "plain",
  "natural",
  "pure",
  "baby",
  "seedless",
  "peeled",
  "trimmed",
  "halved",
  "quartered",
  "crushed",
  "packed",
  "drained",
  "softened",
  "melted",
  "cold",
  "thinly",
  "coarsely",
  "finely",
  "roughly",
  "lean",
  "fatty",
  "low",
  "fat",
  "free",
  "of",
  "the",
  "a",
  "an",
]);

// ---------------------------------------------------------------------------------
// Compound-food allowlist — mirrors the compound examples called out in
// `openai.ts`'s normalization prompt ("almond milk", "olive oil", "peanut butter",
// "ice cream") plus other common multi-word grocery foods where naively keeping only
// the last token would change the food identity (e.g. "almond milk" -> "milk" is
// wrong; it's a distinct product with different allergen/dietary properties).
//
// Checked BEFORE stopword stripping and singularization, as a contiguous token
// sequence anywhere in the input, so "unsweetened almond milk" still resolves to
// "almond milk" rather than degrading to "almond" or "milk".
// ---------------------------------------------------------------------------------
const COMPOUND_ALLOWLIST = [
  "almond milk",
  "oat milk",
  "soy milk",
  "coconut milk",
  "olive oil",
  "vegetable oil",
  "canola oil",
  "sesame oil",
  "coconut oil",
  "peanut butter",
  "almond butter",
  "ice cream",
  "sour cream",
  "cream cheese",
  "greek yogurt",
  "soy sauce",
  "hot sauce",
  "fish sauce",
  "maple syrup",
  "brown sugar",
  "powdered sugar",
  "baking soda",
  "baking powder",
  "chicken broth",
  "beef broth",
  "vegetable broth",
  "bell pepper",
  "green onion",
  "red onion",
  "sweet potato",
  "brown rice",
  "white rice",
  "bay leaf",
  "cream of tartar",
]
  // Longest phrase first so a 3-word compound is tried before any 2-word substring
  // of it would otherwise match first.
  .sort((a, b) => b.split(" ").length - a.split(" ").length);

const COMPOUND_TOKEN_LISTS = COMPOUND_ALLOWLIST.map((phrase) => phrase.split(" "));

// ---------------------------------------------------------------------------------
// Cut / form / part words — curated for `reconcile.ts`'s pantry index, NOT used by
// `normalizeIngredientName` itself. When one of these is the LAST token of a
// normalized pantry item name, the food identity lives in the preceding token(s):
// "chicken breast" IS chicken, so a pantry entry named "Chicken Breast" should be
// reachable by the ingredient "chicken", not just by the full phrase. This is the
// mirror-image problem to STOPWORDS/COMPOUND_ALLOWLIST above: those two exist so
// normalization doesn't destroy food identity; this list exists so `reconcile.ts`'s
// tail-anchored index doesn't *miss* food identity when a cut/form word is appended.
//
// Deliberately NOT folded into STOPWORDS: a stopword is dropped wherever it appears
// in the token stream (any position), but a cut/form word must only be treated this
// way when it's the TAIL — stripping it globally would be wrong (nothing here is
// meant to disappear from e.g. "rib eye steak" mid-phrase handling; `reconcile.ts`
// only strips a *trailing* run of these).
//
// Interaction verified against STOPWORDS: "ground" is already a STOPWORD (line ~40
// above), so `normalizeIngredientName` strips it at ANY position before `reconcile.ts`
// ever sees tokens — "Ground Beef" already normalizes straight to "beef". "ground"
// can therefore never actually be the last token reconcile.ts's index-builder
// inspects; it's kept in this list only for spec completeness / defensiveness (same
// spirit as the `leaves_of_lettuce` no-op key in IRREGULAR_PLURALS below) and is
// inert in practice. "mince" is NOT a stopword (only "minced" is), so "Beef Mince"
// does reach this list's stripping logic for real.
//
// Plural forms (thighs, chops, ribs, wings, slices, chunks, strips) are included for
// the same defensiveness: `normalizeIngredientName` singularizes every token before
// `reconcile.ts` builds its index (see `singularizeToken` below), so in practice only
// the singular forms are ever matched against — but keeping both costs nothing and
// protects against a future change to the singularization pipeline.
//
// "chuck" is an addition beyond the minimum list this was seeded from, needed for
// "Beef Chuck Roast" (grocery butcher naming is often SPECIES + PRIMAL-CUT + FORM,
// e.g. "Beef Chuck Roast", "Pork Sirloin Chop"). `reconcile.ts`'s stripping is
// iterative — it keeps popping trailing cut/form words, not just one — so once
// "roast" strips off "beef chuck roast" leaving "beef chuck", "chuck" being in this
// set too lets the SAME tail-anchored strip continue one more step down to plain
// "beef", rather than requiring a separate (and riskier) prefix-matching rule. Adding
// more of these primal/subprimal names (sirloin, brisket, flank, shoulder, ...) later
// is safe by the same reasoning, as long as each is itself a genuine tail-position
// modifier and not a food in its own right.
// ---------------------------------------------------------------------------------
export const CUT_FORM_WORDS: ReadonlySet<string> = new Set([
  "breast",
  "thigh",
  "thighs",
  "fillet",
  "filet",
  "loin",
  "tenderloin",
  "chop",
  "chops",
  "roast",
  "cutlet",
  "drumstick",
  "wing",
  "wings",
  "shank",
  "rib",
  "ribs",
  "block",
  "loaf",
  "slice",
  "slices",
  "chunk",
  "chunks",
  "ground",
  "mince",
  "steak",
  "strip",
  "strips",
  "half",
  "quarter",
  "piece",
  "pieces",
  "chuck",
]);

/**
 * Curated staples that are never added to the shopping list regardless of whether
 * they're in the pantry (plan §2.3) — otherwise every generated plan demands you buy
 * salt. Values here are already in normalized form (lowercase, singular, no
 * descriptors) since callers check membership with the output of
 * `normalizeIngredientName`.
 */
export const STAPLES: ReadonlySet<string> = new Set([
  "salt",
  "kosher salt",
  "sea salt",
  "pepper",
  "black pepper",
  "white pepper",
  "water",
  "ice",
  "cooking oil",
  "vegetable oil",
  "canola oil",
  "olive oil",
  "sugar",
  "brown sugar",
  "flour",
  "baking soda",
  "baking powder",
  "cornstarch",
  "yeast",
  "vinegar",
  "cooking spray",
  "garlic powder",
  "onion powder",
  "paprika",
  "cumin",
  "cinnamon",
  "oregano",
  "basil",
  "thyme",
  "rosemary",
  "bay leaf",
  "chili powder",
  "cayenne pepper",
  "nutmeg",
  "vanilla extract",
  "red pepper flake",
  "italian seasoning",
]);

/** True if a normalized ingredient name is a curated staple (plan §2.3). */
export function isStaple(normalizedName: string): boolean {
  return STAPLES.has(normalizedName);
}

// ---------------------------------------------------------------------------------
// Naive singularization with irregular handling. Deliberately simple — a full
// inflection library is overkill for grocery nouns, and "naive singularization" is
// exactly what plan §2.3 asks for.
// ---------------------------------------------------------------------------------
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
  people: "person",
  children: "child",
  geese: "goose",
  feet: "foot",
  teeth: "tooth",
  mice: "mouse",
  leaves_of_lettuce: "leaf", // defensive no-op key, never matched
};

// Mass nouns / words that end in "s" but are already singular — a naive trailing-"s"
// strip would otherwise mangle these into nonsense.
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
  "beans", // "beans" is conventionally treated as the base form for the food
  "peas", // same — "pea" reads oddly as a grocery ingredient name
  "swiss",
]);

function singularizeToken(word: string): string {
  if (word.length <= 2) return word;
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
 * Finds the longest compound-food phrase (from {@link COMPOUND_ALLOWLIST}) that
 * appears as a contiguous run of tokens anywhere in `tokens`, and returns it, or
 * `null` if none match.
 */
function findCompound(tokens: string[]): string | null {
  for (let i = 0; i < COMPOUND_TOKEN_LISTS.length; i++) {
    const compoundTokens = COMPOUND_TOKEN_LISTS[i]!;
    const n = compoundTokens.length;
    for (let start = 0; start + n <= tokens.length; start++) {
      let matches = true;
      for (let j = 0; j < n; j++) {
        if (tokens[start + j] !== compoundTokens[j]) {
          matches = false;
          break;
        }
      }
      if (matches) return COMPOUND_ALLOWLIST[i]!;
    }
  }
  return null;
}

/**
 * Normalizes a raw ingredient or pantry-item name to a canonical join key.
 *
 * Pipeline: lowercase -> strip parenthetical asides -> strip punctuation -> check the
 * compound-food allowlist (returned as-is if hit, e.g. "almond milk") -> drop
 * stopwords -> naive singularization of each remaining token.
 *
 * Pure and synchronous — never calls an LLM, the DB, or the network.
 *
 * @example normalizeIngredientName("2 Roma Tomatoes, chopped") // "tomato"
 * @example normalizeIngredientName("Unsweetened Almond Milk (32 oz)") // "almond milk"
 * @example normalizeIngredientName("Whole Milk") // "milk"
 */
export function normalizeIngredientName(raw: string): string {
  if (!raw) return "";

  let s = raw.toLowerCase();
  s = s.replace(/\([^)]*\)/g, " "); // parenthetical asides: "milk (32 oz)" -> "milk"
  s = s.replace(/[^a-z0-9\s-]/g, " "); // strip punctuation
  s = s.replace(/-/g, " "); // hyphens act as word breaks ("low-fat" -> "low fat")
  s = s.replace(/\s+/g, " ").trim();

  if (!s) return "";

  const tokens = s.split(" ").filter(Boolean);

  const compound = findCompound(tokens);
  if (compound) return compound;

  const withoutStopwords = tokens.filter((t) => !STOPWORDS.has(t));
  const kept = withoutStopwords.length > 0 ? withoutStopwords : tokens;

  return kept.map(singularizeToken).join(" ").trim();
}
