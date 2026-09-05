import { describe, it, expect } from "vitest";
import {
  aggregateMealPlanIngredients,
  normalizeIngredientName,
  summarizeIngredientAggregates,
  toBuyCountsByDay,
  groupAggregatesByStatus,
  formatUsedOnChip,
  type MealPlanIngredientsPlanInput,
} from "@/lib/mealPlanIngredients";
import type { InventoryItem, MealPlanIngredient } from "@/lib/api";

function makeIngredient(overrides: Partial<MealPlanIngredient> = {}): MealPlanIngredient {
  return {
    id: `ing-${Math.random()}`,
    householdId: "household-1",
    mealId: "meal-1",
    rawText: "1 onion",
    nameNormalized: "onion",
    quantity: 1,
    unit: "unit",
    preparation: null,
    optional: false,
    source: "purchase",
    sourceOverridden: false,
    matchedItemId: null,
    shoppingListItemId: null,
    matchConfidence: null,
    sortOrder: 0,
    ...overrides,
  };
}

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: `item-${Math.random()}`,
    name: "Onion",
    brand: null,
    quantity: 1,
    unit: "unit",
    location: "pantry",
    category: null,
    expirationDate: null,
    expirationEstimated: false,
    barcodeUpc: null,
    imageUrl: null,
    notes: null,
    householdId: "household-1",
    addedBy: "user-1",
    addedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    opened: false,
    ...overrides,
  };
}

function makePlan(
  days: MealPlanIngredientsPlanInput["days"],
  startDate = "2026-09-08"
): MealPlanIngredientsPlanInput {
  return { startDate, days };
}

describe("normalizeIngredientName", () => {
  it("lowercases and trims", () => {
    expect(normalizeIngredientName("  Onion  ")).toBe("onion");
  });

  it("strips punctuation", () => {
    expect(normalizeIngredientName("Onion.")).toBe("onion");
    expect(normalizeIngredientName("Onion, diced")).toBe("onion diced");
  });

  it("singularizes a trailing s", () => {
    expect(normalizeIngredientName("Onions")).toBe("onion");
    // "tomatoe" is not a word — irregular plurals get their own mapping, matching the
    // server's normalizer (server/src/test/lib/mealplan/ingredients.test.ts).
    expect(normalizeIngredientName("Tomatoes")).toBe("tomato");
  });

  it("leaves a word that already ends in a double-s alone", () => {
    expect(normalizeIngredientName("Grass")).toBe("grass");
  });

  it("leaves short words alone even if they end in s", () => {
    expect(normalizeIngredientName("gas")).toBe("gas");
  });

  it("does not corrupt mass nouns that end in s but are already singular", () => {
    // These used to lose a letter they need ("asparagus" -> "asparagu") because the old
    // implementation only special-cased words ending in a literal "ss".
    expect(normalizeIngredientName("Asparagus")).toBe("asparagus");
    expect(normalizeIngredientName("Hummus")).toBe("hummus");
    expect(normalizeIngredientName("Citrus")).toBe("citrus");
    expect(normalizeIngredientName("Couscous")).toBe("couscous");
  });

  it("does not un-pluralize server-intentional plurals", () => {
    // These read oddly (or mean something else entirely) once singularized: "leafy
    // greens" -> the color, "chive" is not how anyone lists the herb.
    expect(normalizeIngredientName("Chives")).toBe("chives");
    expect(normalizeIngredientName("Greens")).toBe("greens");
    expect(normalizeIngredientName("Beans")).toBe("beans");
    expect(normalizeIngredientName("Peas")).toBe("peas");
  });
});

describe("aggregateMealPlanIngredients", () => {
  it("returns nothing for an empty plan", () => {
    expect(aggregateMealPlanIngredients(makePlan([]), [])).toEqual([]);
  });

  it("sums same-unit quantities across meals into one aggregate", () => {
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Breakfast Hash",
            ingredients: [
              makeIngredient({ id: "ing-1", mealId: "meal-1", quantity: 2, unit: "cup" }),
            ],
          },
          {
            id: "meal-2",
            title: "Dinner Soup",
            ingredients: [
              makeIngredient({ id: "ing-2", mealId: "meal-2", quantity: 1, unit: "cup" }),
            ],
          },
        ],
      },
    ]);

    const aggregates = aggregateMealPlanIngredients(plan, []);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]?.quantityLabel).toBe("3 cups");
    expect(aggregates[0]?.ingredientIds.sort()).toEqual(["ing-1", "ing-2"]);
  });

  it("renders mixed units as a joined string, never a fabricated conversion", () => {
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Breakfast Hash",
            ingredients: [
              makeIngredient({ id: "ing-1", mealId: "meal-1", quantity: 2, unit: "cup" }),
              makeIngredient({ id: "ing-2", mealId: "meal-1", quantity: 1, unit: "unit" }),
            ],
          },
        ],
      },
    ]);

    const aggregates = aggregateMealPlanIngredients(plan, []);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]?.quantityLabel).toBe("2 cups + 1 unit");
  });

  it("aggregates the same ingredient used at breakfast AND dinner on the same day ONCE, not twice", () => {
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-breakfast",
            title: "Breakfast Hash",
            ingredients: [
              makeIngredient({ id: "ing-1", mealId: "meal-breakfast", quantity: 1, unit: "unit" }),
            ],
          },
          {
            id: "meal-dinner",
            title: "Dinner Soup",
            ingredients: [
              makeIngredient({ id: "ing-2", mealId: "meal-dinner", quantity: 1, unit: "unit" }),
            ],
          },
        ],
      },
    ]);

    const aggregates = aggregateMealPlanIngredients(plan, []);
    // ONE aggregate, not two — this is the "double count" bug plan §11.1 warns about.
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]?.usedOn).toHaveLength(2);
    expect(aggregates[0]?.usedOn.map((u) => u.dayIndex)).toEqual([0, 0]);

    // And the per-day "to buy" count still counts it as ONE ingredient for day 0,
    // not two, even though it was used in two meals that day.
    const counts = toBuyCountsByDay(aggregates);
    expect(counts.get(0)).toBe(1);
  });

  it("never includes staple ingredients on the buy list", () => {
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Breakfast Hash",
            ingredients: [
              makeIngredient({ id: "ing-1", nameNormalized: "salt", source: "staple" }),
            ],
          },
        ],
      },
    ]);

    expect(aggregateMealPlanIngredients(plan, [])).toEqual([]);
  });

  it("lets a manual sourceOverridden flip win over the computed value", () => {
    const matched = makeItem({ id: "item-1", quantity: 0 }); // would otherwise be must_buy
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Dinner",
            ingredients: [
              makeIngredient({
                id: "ing-1",
                matchedItemId: "item-1",
                source: "pantry",
                sourceOverridden: true,
              }),
            ],
          },
        ],
      },
    ]);

    const aggregates = aggregateMealPlanIngredients(plan, [matched]);
    expect(aggregates[0]?.status).toBe("have");

    // And the reverse: an override to "purchase" forces must_buy even against a
    // perfectly healthy, in-stock, non-expiring matched item.
    const healthyMatch = makeItem({ id: "item-2", quantity: 5, expirationDate: null });
    const overriddenToBuy = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Dinner",
            ingredients: [
              makeIngredient({
                id: "ing-2",
                matchedItemId: "item-2",
                source: "purchase",
                sourceOverridden: true,
              }),
            ],
          },
        ],
      },
    ]);
    expect(aggregateMealPlanIngredients(overriddenToBuy, [healthyMatch])[0]?.status).toBe(
      "must_buy"
    );
  });

  it("treats a matched item's zero quantity the same as no match at all (must buy)", () => {
    const matched = makeItem({ id: "item-1", quantity: 0 });
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Dinner",
            ingredients: [makeIngredient({ id: "ing-1", matchedItemId: "item-1" })],
          },
        ],
      },
    ]);

    expect(aggregateMealPlanIngredients(plan, [matched])[0]?.status).toBe("must_buy");
  });

  it("treats a missing expiration date as never-expiring (plain have it)", () => {
    const matched = makeItem({ id: "item-1", quantity: 3, expirationDate: null });
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Dinner",
            ingredients: [makeIngredient({ id: "ing-1", matchedItemId: "item-1" })],
          },
        ],
      },
    ]);

    const aggregates = aggregateMealPlanIngredients(plan, [matched]);
    expect(aggregates[0]?.status).toBe("have");
    expect(aggregates[0]?.expiryLabel).toBeNull();
  });

  it("marks an item expiring EXACTLY on its last day of use as have_expiring (inclusive boundary)", () => {
    // Plan starts 2026-09-08 (a Tuesday); the ingredient is used on dayIndex 2 ->
    // 2026-09-10. An item that expires on that exact date is "expiring", not "safe".
    const matched = makeItem({ id: "item-1", quantity: 2, expirationDate: "2026-09-10" });
    const plan = makePlan(
      [
        {
          dayIndex: 2,
          meals: [
            {
              id: "meal-1",
              title: "Dinner",
              ingredients: [makeIngredient({ id: "ing-1", matchedItemId: "item-1" })],
            },
          ],
        },
      ],
      "2026-09-08"
    );

    const aggregates = aggregateMealPlanIngredients(plan, [matched]);
    expect(aggregates[0]?.status).toBe("have_expiring");
    expect(aggregates[0]?.expiryLabel).toBeTruthy();

    // One day later it's no longer expiring by the time it's needed.
    const safeMatch = makeItem({ id: "item-2", quantity: 2, expirationDate: "2026-09-11" });
    const safePlan = makePlan(
      [
        {
          dayIndex: 2,
          meals: [
            {
              id: "meal-1",
              title: "Dinner",
              ingredients: [makeIngredient({ id: "ing-1", matchedItemId: "item-2" })],
            },
          ],
        },
      ],
      "2026-09-08"
    );
    expect(aggregateMealPlanIngredients(safePlan, [safeMatch])[0]?.status).toBe("have");
  });

  it("uses the LAST day of use across multiple occurrences, not the first", () => {
    // Used on day 0 and day 5; expires day 2 — safe for the first use, expired by the
    // second. The aggregate must reflect the risk of the LATER use.
    const matched = makeItem({ id: "item-1", quantity: 1, expirationDate: "2026-09-10" });
    const plan = makePlan(
      [
        {
          dayIndex: 0,
          meals: [
            {
              id: "meal-1",
              title: "Monday Lunch",
              ingredients: [makeIngredient({ id: "ing-1", matchedItemId: "item-1" })],
            },
          ],
        },
        {
          dayIndex: 5,
          meals: [
            {
              id: "meal-2",
              title: "Saturday Lunch",
              ingredients: [makeIngredient({ id: "ing-2", matchedItemId: "item-1" })],
            },
          ],
        },
      ],
      "2026-09-08"
    );

    expect(aggregateMealPlanIngredients(plan, [matched])[0]?.status).toBe("have_expiring");
  });

  it("treats no match at all as must_buy", () => {
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Dinner",
            ingredients: [makeIngredient({ id: "ing-1", matchedItemId: null })],
          },
        ],
      },
    ]);
    expect(aggregateMealPlanIngredients(plan, [])[0]?.status).toBe("must_buy");
  });

  it("uses the server-provided nameNormalized as-is, without a second client-side normalization pass", () => {
    // The server's normalizer already curates mass nouns like "asparagus" (see
    // server/src/lib/ingredients.ts SINGULARIZE_EXCEPTIONS). Re-running the naive
    // client normalizer over an already-normalized value used to strip a letter it
    // needs ("asparagus" -> "asparagu"). The aggregate key AND the displayed label
    // must both come out uncorrupted.
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Dinner",
            ingredients: [
              makeIngredient({ id: "ing-1", nameNormalized: "asparagus", matchedItemId: null }),
            ],
          },
        ],
      },
    ]);

    const aggregates = aggregateMealPlanIngredients(plan, []);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]?.nameNormalized).toBe("asparagus");
    expect(aggregates[0]?.displayName).toBe("Asparagus");
  });
});

describe("summarizeIngredientAggregates", () => {
  it("counts total ingredients and how many must be bought", () => {
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Dinner",
            ingredients: [
              makeIngredient({ id: "ing-1", nameNormalized: "onion", matchedItemId: null }),
              makeIngredient({
                id: "ing-2",
                nameNormalized: "garlic",
                matchedItemId: "item-1",
              }),
            ],
          },
        ],
      },
    ]);
    const matched = makeItem({ id: "item-1", quantity: 2, expirationDate: null });
    const aggregates = aggregateMealPlanIngredients(plan, [matched]);
    expect(summarizeIngredientAggregates(aggregates)).toEqual({
      totalIngredients: 2,
      toBuyCount: 1,
    });
  });

  it("returns zero counts for an empty list", () => {
    expect(summarizeIngredientAggregates([])).toEqual({ totalIngredients: 0, toBuyCount: 0 });
  });
});

describe("groupAggregatesByStatus", () => {
  it("orders groups Must buy -> Expiring -> Have it", () => {
    const plan = makePlan([
      {
        dayIndex: 0,
        meals: [
          {
            id: "meal-1",
            title: "Dinner",
            ingredients: [
              makeIngredient({ id: "ing-1", nameNormalized: "flour", matchedItemId: null }),
              makeIngredient({ id: "ing-2", nameNormalized: "milk", matchedItemId: "item-milk" }),
              // "egg" (not "eggs") — nameNormalized is server-derived and already
              // singular; the aggregation must use it as-is (see Bug 1 fix above), not
              // re-run it through the naive client normalizer.
              makeIngredient({ id: "ing-3", nameNormalized: "egg", matchedItemId: "item-eggs" }),
            ],
          },
        ],
      },
    ]);
    const inventory = [
      makeItem({ id: "item-milk", quantity: 1, expirationDate: "2026-09-08" }),
      makeItem({ id: "item-eggs", quantity: 12, expirationDate: null }),
    ];
    const groups = groupAggregatesByStatus(aggregateMealPlanIngredients(plan, inventory));
    expect(groups.map((g) => g.status)).toEqual(["must_buy", "have_expiring", "have"]);
    expect(groups[0]?.items.map((i) => i.nameNormalized)).toEqual(["flour"]);
    expect(groups[1]?.items.map((i) => i.nameNormalized)).toEqual(["milk"]);
    expect(groups[2]?.items.map((i) => i.nameNormalized)).toEqual(["egg"]);
  });
});

describe("formatUsedOnChip", () => {
  it("formats a weekday abbreviation and the meal title", () => {
    // 2026-09-08 is a Tuesday.
    expect(
      formatUsedOnChip({ dayIndex: 0, mealId: "meal-1", mealTitle: "Onion Soup" }, "2026-09-08")
    ).toBe("Tue · Onion Soup");
    // dayIndex 1 -> Wednesday.
    expect(
      formatUsedOnChip({ dayIndex: 1, mealId: "meal-2", mealTitle: "Tacos" }, "2026-09-08")
    ).toBe("Wed · Tacos");
  });
});
