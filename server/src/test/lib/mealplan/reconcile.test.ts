import { describe, test, expect } from "bun:test";
import {
  buildPantryIndex,
  matchIngredient,
  buildRawText,
  reconcilePlan,
  type IngredientOccurrence,
} from "../../../lib/mealplan/reconcile";
import type { PantryItem } from "../../../lib/mealplan/prompt";

function makePantryItem(overrides: Partial<PantryItem> = {}): PantryItem {
  return {
    id: "item-1",
    name: "onion",
    quantity: 3,
    unit: "unit",
    location: "pantry",
    category: "Produce",
    expirationDate: null,
    opened: false,
    ...overrides,
  };
}

function occ(overrides: Partial<IngredientOccurrence> = {}): IngredientOccurrence {
  return {
    dayIndex: 0,
    mealId: "meal-1",
    mealTitle: "Test Meal",
    ingredient: { name: "onion", quantity: 1, unit: "unit", preparation: null, optional: false },
    ...overrides,
  };
}

describe("buildRawText", () => {
  test("builds a display string from quantity/unit/preparation/name", () => {
    expect(
      buildRawText({
        quantity: 2,
        unit: "cups",
        preparation: "chopped",
        name: "onion",
        optional: false,
      })
    ).toBe("2 cups chopped onion");
  });

  test("omits missing fields cleanly", () => {
    expect(
      buildRawText({ quantity: null, unit: null, preparation: null, name: "salt", optional: false })
    ).toBe("salt");
    expect(
      buildRawText({ quantity: 1, unit: null, preparation: null, name: "egg", optional: false })
    ).toBe("1 egg");
  });
});

describe("matchIngredient", () => {
  test("exact normalized equality matches with confidence 1.0", () => {
    const index = buildPantryIndex([makePantryItem({ name: "onion" })]);
    const result = matchIngredient("onion", index);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  test("whole-token containment matches with confidence 0.8", () => {
    const index = buildPantryIndex([makePantryItem({ name: "yellow onion" })]);
    const result = matchIngredient("onion", index);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe(0.8);
  });

  test("false-positive guard: 'milk' must NOT match 'milk chocolate'", () => {
    const index = buildPantryIndex([makePantryItem({ id: "choc", name: "milk chocolate" })]);
    const result = matchIngredient("milk", index);
    expect(result.matched).toBe(false);
  });

  test("'milk' matches 'whole milk' but not 'almond milk'", () => {
    const index = buildPantryIndex([
      makePantryItem({ id: "whole", name: "whole milk" }),
      makePantryItem({ id: "almond", name: "almond milk" }),
    ]);
    const result = matchIngredient("milk", index);
    expect(result.matched).toBe(true);
    expect(result.entry?.id).toBe("whole");
  });

  test("no match returns confidence 0", () => {
    const index = buildPantryIndex([makePantryItem({ name: "onion" })]);
    const result = matchIngredient("kiwi", index);
    expect(result.matched).toBe(false);
    expect(result.confidence).toBe(0);
  });

  describe("tier 3: cut/form-word core match (confidence 0.7)", () => {
    // Every row from the bug report: a recipe ingredient that is the food-bearing
    // PREFIX of a pantry item whose tail is a curated cut/form word. Before the fix,
    // tail-anchored tier 2 could never reach any of these (the tail token is the cut
    // word, not the food), so all six were false negatives — the app told you to buy
    // food you already owned.
    test("'chicken' matches 'Chicken Breast'", () => {
      const index = buildPantryIndex([makePantryItem({ name: "Chicken Breast" })]);
      const result = matchIngredient("chicken", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.7);
    });

    test("'chicken' matches 'Chicken Thighs'", () => {
      const index = buildPantryIndex([makePantryItem({ name: "Chicken Thighs" })]);
      const result = matchIngredient("chicken", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.7);
    });

    test("'salmon' matches 'Wild Alaskan Salmon Fillet'", () => {
      const index = buildPantryIndex([makePantryItem({ name: "Wild Alaskan Salmon Fillet" })]);
      const result = matchIngredient("salmon", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.7);
    });

    test("'pork' matches 'Pork Loin'", () => {
      const index = buildPantryIndex([makePantryItem({ name: "Pork Loin" })]);
      const result = matchIngredient("pork", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.7);
    });

    test("'beef' matches 'Beef Chuck Roast'", () => {
      const index = buildPantryIndex([makePantryItem({ name: "Beef Chuck Roast" })]);
      const result = matchIngredient("beef", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.7);
    });

    test("'bread' matches 'Sourdough Bread Loaf'", () => {
      const index = buildPantryIndex([makePantryItem({ name: "Sourdough Bread Loaf" })]);
      const result = matchIngredient("bread", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.7);
    });

    test("'cheddar cheese' matches 'Cheddar Cheese Block'", () => {
      const index = buildPantryIndex([makePantryItem({ name: "Cheddar Cheese Block" })]);
      const result = matchIngredient("cheddar cheese", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.7);
    });

    test("tier 2 still wins over tier 3 when both would apply", () => {
      // "chicken breast" ingredient vs "Chicken Breast" pantry item is an exact
      // (tier 1) match, not tier 3 — sanity check the tiers don't get reordered.
      const index = buildPantryIndex([makePantryItem({ name: "Chicken Breast" })]);
      const result = matchIngredient("chicken breast", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    test("'ground beef' pantry item still matches 'beef' at tier 1 (via stopword removal, not cut-word stripping)", () => {
      // "ground" is already a STOPWORD, so "Ground Beef" normalizes straight to
      // "beef" before reconcile.ts ever builds the cut-word index. Confirms no
      // double-handling / regression from adding "ground" to CUT_FORM_WORDS too.
      const index = buildPantryIndex([makePantryItem({ name: "Ground Beef" })]);
      const result = matchIngredient("beef", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    test("preserved negative: 'milk' still does NOT match 'milk chocolate'", () => {
      const index = buildPantryIndex([makePantryItem({ id: "choc", name: "milk chocolate" })]);
      const result = matchIngredient("milk", index);
      expect(result.matched).toBe(false);
    });

    test("preserved negative: 'chocolate' still matches 'milk chocolate'", () => {
      const index = buildPantryIndex([makePantryItem({ id: "choc", name: "milk chocolate" })]);
      const result = matchIngredient("chocolate", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.8); // tail-anchored tier 2, unaffected by cut words
    });

    test("negative: 'chicken' does NOT match 'Chicken Noodle Soup' (tail is not a cut/form word)", () => {
      const index = buildPantryIndex([makePantryItem({ name: "Chicken Noodle Soup" })]);
      const result = matchIngredient("chicken", index);
      expect(result.matched).toBe(false);
    });

    test("negative: 'almond' does NOT match 'Almond Milk' (last token 'milk' is not a cut/form word)", () => {
      const index = buildPantryIndex([makePantryItem({ name: "Almond Milk" })]);
      const result = matchIngredient("almond", index);
      expect(result.matched).toBe(false);
    });

    test("negative: a standalone pantry item named 'Breast' is not stripped down to nothing", () => {
      // stripTrailingCutWords must always leave at least one token; "chicken" must
      // not spuriously match a pantry item whose entire name is just the cut word.
      const index = buildPantryIndex([makePantryItem({ name: "Breast" })]);
      const result = matchIngredient("chicken", index);
      expect(result.matched).toBe(false);
    });

    test("negative: 'buffalo' does NOT match 'Buffalo Wings' at exact/tier-1 confidence", () => {
      // Known, bounded risk: "wing" is a legitimate cut/form word ("Chicken Wing" IS
      // chicken), but when the word preceding it is a STYLE/SAUCE descriptor rather
      // than an animal ("Buffalo Wings"), stripping "wing" produces a core ("buffalo")
      // that reads like a different animal (bison) entirely. This is an accepted,
      // curated-list-inherent limitation (documented on MatchResult.confidence) rather
      // than a hard failure: it's scored at 0.7, strictly below both tier 1 (1.0) and
      // tier 2 (0.8), so it can never masquerade as a confident/exact match, and a
      // real recipe calling for "buffalo" (bison) meat is rare enough that this is an
      // acceptable trade against fixing the chicken/salmon/pork/beef/bread/cheese
      // false negatives above. This test locks in that it stays bounded to 0.7 and
      // never escalates.
      const index = buildPantryIndex([makePantryItem({ name: "Buffalo Wings" })]);
      const result = matchIngredient("buffalo", index);
      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(0.7);
      expect(result.confidence).toBeLessThan(0.8);
    });
  });

  test("prefers a pantry entry with quantity > 0 over a depleted duplicate", () => {
    const index = buildPantryIndex([
      makePantryItem({ id: "empty", name: "onion", quantity: 0 }),
      makePantryItem({ id: "full", name: "onion", quantity: 5 }),
    ]);
    const result = matchIngredient("onion", index);
    expect(result.entry?.id).toBe("full");
  });
});

describe("reconcilePlan — have/buy classification", () => {
  test("zero quantity is treated as absent (source: purchase)", () => {
    const pantry = [makePantryItem({ name: "onion", quantity: 0 })];
    const { ingredients } = reconcilePlan([occ()], pantry);
    expect(ingredients[0]!.source).toBe("purchase");
  });

  test("positive-quantity match is classified 'pantry'", () => {
    const pantry = [makePantryItem({ name: "onion", quantity: 3 })];
    const { ingredients } = reconcilePlan([occ()], pantry);
    expect(ingredients[0]!.source).toBe("pantry");
    expect(ingredients[0]!.matchedItemId).toBe("item-1");
  });

  test("no pantry match is classified 'purchase'", () => {
    const { ingredients } = reconcilePlan([occ()], []);
    expect(ingredients[0]!.source).toBe("purchase");
    expect(ingredients[0]!.matchedItemId).toBeNull();
  });

  test("a staple is always classified 'staple', even with zero pantry quantity or no match", () => {
    const withZero = reconcilePlan(
      [
        occ({
          ingredient: { name: "salt", quantity: 1, unit: null, preparation: null, optional: false },
        }),
      ],
      [makePantryItem({ name: "salt", quantity: 0 })]
    );
    expect(withZero.ingredients[0]!.source).toBe("staple");

    const withNoMatch = reconcilePlan(
      [
        occ({
          ingredient: { name: "salt", quantity: 1, unit: null, preparation: null, optional: false },
        }),
      ],
      []
    );
    expect(withNoMatch.ingredients[0]!.source).toBe("staple");
  });

  test("staples never appear on the buy list", () => {
    const { buyList } = reconcilePlan(
      [
        occ({
          ingredient: { name: "salt", quantity: 1, unit: null, preparation: null, optional: false },
        }),
      ],
      []
    );
    expect(buyList.find((b) => b.nameNormalized === "salt")).toBeUndefined();
  });

  test("raw_text is built in code from the occurrence's own fields", () => {
    const { ingredients } = reconcilePlan(
      [
        occ({
          ingredient: {
            name: "onion",
            quantity: 2,
            unit: "cups",
            preparation: "diced",
            optional: false,
          },
        }),
      ],
      []
    );
    expect(ingredients[0]!.rawText).toBe("2 cups diced onion");
  });
});

describe("reconcilePlan — aggregation", () => {
  test("duplicate ingredient across days aggregates into one buy-list entry with summed quantity", () => {
    const occurrences: IngredientOccurrence[] = [
      occ({
        dayIndex: 0,
        mealId: "m1",
        mealTitle: "Monday Dinner",
        ingredient: {
          name: "onion",
          quantity: 1,
          unit: "unit",
          preparation: null,
          optional: false,
        },
      }),
      occ({
        dayIndex: 2,
        mealId: "m2",
        mealTitle: "Wednesday Lunch",
        ingredient: {
          name: "onions",
          quantity: 2,
          unit: "unit",
          preparation: null,
          optional: false,
        },
      }),
    ];
    const { buyList } = reconcilePlan(occurrences, []);
    expect(buyList.length).toBe(1);
    expect(buyList[0]!.nameNormalized).toBe("onion");
    expect(buyList[0]!.quantityDisplay).toBe("3 unit");
    expect(buyList[0]!.usedOn.length).toBe(2);
  });

  test("an ingredient used at breakfast AND dinner on the SAME day aggregates once, not twice (plan §11.1)", () => {
    const occurrences: IngredientOccurrence[] = [
      occ({
        dayIndex: 0,
        mealId: "breakfast-1",
        mealTitle: "Monday Breakfast",
        ingredient: { name: "egg", quantity: 2, unit: "unit", preparation: null, optional: false },
      }),
      occ({
        dayIndex: 0,
        mealId: "dinner-1",
        mealTitle: "Monday Dinner",
        ingredient: { name: "eggs", quantity: 3, unit: "unit", preparation: null, optional: false },
      }),
    ];
    const { buyList } = reconcilePlan(occurrences, []);
    expect(buyList.length).toBe(1);
    expect(buyList[0]!.quantityDisplay).toBe("5 unit");
    expect(buyList[0]!.usedOn).toEqual([
      { dayIndex: 0, mealId: "breakfast-1", mealTitle: "Monday Breakfast" },
      { dayIndex: 0, mealId: "dinner-1", mealTitle: "Monday Dinner" },
    ]);
  });

  test("mixed units render as a joined string, never a fabricated conversion", () => {
    // "cheese" (unlike "flour" or "salt") isn't in the curated STAPLES list, so this
    // exercises the buy-list path rather than being short-circuited to "staple".
    const occurrences: IngredientOccurrence[] = [
      occ({
        ingredient: {
          name: "cheese",
          quantity: 2,
          unit: "cups",
          preparation: null,
          optional: false,
        },
      }),
      occ({
        ingredient: { name: "cheese", quantity: 1, unit: null, preparation: null, optional: false },
      }),
    ];
    const { buyList } = reconcilePlan(occurrences, []);
    expect(buyList.length).toBe(1);
    expect(buyList[0]!.quantityDisplay).toBe("2 cups + 1 unit");
  });

  test("aggregation happens before have/buy so the buy list is never double-counted", () => {
    // Two occurrences of the same pantry-matched ingredient must produce exactly one
    // buy-list entry (or none, if matched) — never two separate "purchase" rows for
    // what is really one ingredient.
    const occurrences: IngredientOccurrence[] = [
      occ({
        ingredient: { name: "rice", quantity: 1, unit: "cup", preparation: null, optional: false },
      }),
      occ({
        ingredient: { name: "rice", quantity: 1, unit: "cup", preparation: null, optional: false },
      }),
    ];
    const { buyList, ingredients } = reconcilePlan(occurrences, []);
    expect(buyList.length).toBe(1);
    expect(buyList[0]!.quantityDisplay).toBe("2 cup");
    // Both per-occurrence rows still exist (for per-meal display) and share one classification.
    expect(ingredients.length).toBe(2);
    expect(ingredients[0]!.source).toBe(ingredients[1]!.source);
  });

  test("optional is true on the aggregate only if every occurrence was optional", () => {
    const occurrences: IngredientOccurrence[] = [
      occ({
        ingredient: {
          name: "cilantro",
          quantity: 1,
          unit: "unit",
          preparation: null,
          optional: true,
        },
      }),
      occ({
        ingredient: {
          name: "cilantro",
          quantity: 1,
          unit: "unit",
          preparation: null,
          optional: false,
        },
      }),
    ];
    const { buyList } = reconcilePlan(occurrences, []);
    expect(buyList[0]!.optional).toBe(false);
  });
});

describe("reconcilePlan — performance", () => {
  test("5000 pantry items x 21 meals (~150 ingredients) reconciles in under 500ms", () => {
    const pantryItems: PantryItem[] = Array.from({ length: 5000 }, (_, i) => ({
      id: `pantry-${i}`,
      name: `ingredient-${i % 500} extra descriptor ${i}`,
      quantity: i % 3,
      unit: "unit",
      location: "pantry",
      category: "Misc",
      expirationDate: null,
      opened: false,
    }));

    const occurrences: IngredientOccurrence[] = [];
    for (let day = 0; day < 21; day++) {
      for (let m = 0; m < 4; m++) {
        for (let ing = 0; ing < 8; ing++) {
          occurrences.push({
            dayIndex: day,
            mealId: `day${day}-meal${m}`,
            mealTitle: `Day ${day} Meal ${m}`,
            ingredient: {
              name: `ingredient-${(day * 4 + m + ing) % 500}`,
              quantity: 1,
              unit: "unit",
              preparation: null,
              optional: false,
            },
          });
        }
      }
    }

    const start = performance.now();
    const result = reconcilePlan(occurrences, pantryItems);
    const elapsedMs = performance.now() - start;

    expect(result.ingredients.length).toBe(occurrences.length);
    expect(elapsedMs).toBeLessThan(500);
  });
});
