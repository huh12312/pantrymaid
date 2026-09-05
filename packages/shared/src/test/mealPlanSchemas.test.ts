import { describe, it, expect } from "vitest";
import {
  localDateStringSchema,
  mealSlotSchema,
  mealPlanModeSchema,
  mealPlanStatusSchema,
  mealPlanDetailStatusSchema,
  ingredientSourceSchema,
  mealPlanIngredientSchema,
  mealPlanMealSchema,
  mealPlanDaySchema,
  mealPlanSchema,
  createMealPlanSchema,
  updateMealPlanIngredientSchema,
  mealPlanShoppingStateSchema,
  mealPlanShoppingUsedOnSchema,
  mealPlanShoppingAggregateSchema,
  mealPlanShoppingListSchema,
  commitMealPlanShoppingSchema,
} from "../schemas";

const UUID_A = "123e4567-e89b-12d3-a456-426614174000";
const UUID_B = "123e4567-e89b-12d3-a456-426614174001";
const UUID_C = "123e4567-e89b-12d3-a456-426614174002";
const UUID_D = "123e4567-e89b-12d3-a456-426614174003";

const validIngredient = {
  id: UUID_A,
  householdId: UUID_B,
  mealId: UUID_C,
  rawText: "2 cups chopped onion",
  nameNormalized: "onion",
  quantity: 2,
  unit: "cup",
  preparation: "chopped",
  optional: false,
  source: "pantry" as const,
  sourceOverridden: false,
  matchedItemId: UUID_D,
  shoppingListItemId: null,
  matchConfidence: 1,
  sortOrder: 0,
};

const validMeal = {
  id: UUID_A,
  householdId: UUID_B,
  planId: UUID_C,
  dayId: UUID_D,
  slot: "dinner" as const,
  sortOrder: 0,
  title: "Onion Soup",
  summary: "A simple weeknight soup",
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 30,
  instructions: ["Chop the onions.", "Simmer for 30 minutes."],
  detailStatus: "ready" as const,
  detailError: null,
};

const validDay = {
  id: UUID_A,
  householdId: UUID_B,
  planId: UUID_C,
  dayIndex: 0,
  date: "2026-09-07",
};

const validPlan = {
  id: UUID_A,
  householdId: UUID_B,
  startDate: "2026-09-07",
  dayCount: 7,
  mode: "balanced" as const,
  includeExpired: false,
  status: "ready" as const,
  progressDone: 28,
  progressTotal: 28,
  promptId: null,
  providerSnapshot: "openai",
  modelSnapshot: "gpt-5.4-mini",
  inputTokens: 1200,
  outputTokens: 3400,
  generationMs: 45000,
  priorityCoverage: 0.8,
  errorCode: null,
  errorMessage: null,
  errorRetryAfterSeconds: null,
  requestedBy: "user_2f8f9c0e0a0b",
  createdAt: new Date(),
  completedAt: new Date(),
};

describe("localDateStringSchema", () => {
  it("accepts a YYYY-MM-DD string", () => {
    expect(localDateStringSchema.parse("2026-09-04")).toBe("2026-09-04");
  });
  it("rejects a full ISO datetime string", () => {
    expect(() => localDateStringSchema.parse("2026-09-04T23:30:00-05:00")).toThrow();
  });
  it("rejects a Date instance and garbage strings", () => {
    expect(() => localDateStringSchema.parse(new Date())).toThrow();
    expect(() => localDateStringSchema.parse("09/04/2026")).toThrow();
  });
});

describe("mealSlotSchema", () => {
  it("accepts all four slots", () => {
    for (const slot of ["breakfast", "lunch", "dinner", "snack"]) {
      expect(mealSlotSchema.parse(slot)).toBe(slot);
    }
  });
  it("rejects an unknown slot", () => {
    expect(() => mealSlotSchema.parse("brunch")).toThrow();
  });
});

describe("mealPlanModeSchema", () => {
  it("accepts balanced and expiring_first", () => {
    expect(mealPlanModeSchema.parse("balanced")).toBe("balanced");
    expect(mealPlanModeSchema.parse("expiring_first")).toBe("expiring_first");
  });
  it("rejects an unknown mode", () => {
    expect(() => mealPlanModeSchema.parse("random")).toThrow();
  });
});

describe("mealPlanStatusSchema", () => {
  it("accepts every documented status", () => {
    const statuses = [
      "queued",
      "generating_skeleton",
      "generating_recipes",
      "ready",
      "failed",
      "cancelled",
    ];
    for (const status of statuses) {
      expect(mealPlanStatusSchema.parse(status)).toBe(status);
    }
  });
  it("rejects an unknown status", () => {
    expect(() => mealPlanStatusSchema.parse("done")).toThrow();
  });
});

describe("mealPlanDetailStatusSchema", () => {
  it("accepts pending, ready, failed", () => {
    expect(mealPlanDetailStatusSchema.parse("pending")).toBe("pending");
    expect(mealPlanDetailStatusSchema.parse("ready")).toBe("ready");
    expect(mealPlanDetailStatusSchema.parse("failed")).toBe("failed");
  });
  it("rejects an unknown detail status", () => {
    expect(() => mealPlanDetailStatusSchema.parse("in_progress")).toThrow();
  });
});

describe("ingredientSourceSchema", () => {
  it("accepts pantry, purchase, staple", () => {
    expect(ingredientSourceSchema.parse("pantry")).toBe("pantry");
    expect(ingredientSourceSchema.parse("purchase")).toBe("purchase");
    expect(ingredientSourceSchema.parse("staple")).toBe("staple");
  });
  it("rejects an unknown source", () => {
    expect(() => ingredientSourceSchema.parse("garden")).toThrow();
  });
});

describe("mealPlanIngredientSchema", () => {
  it("accepts a fully-populated row", () => {
    const result = mealPlanIngredientSchema.parse(validIngredient);
    expect(result.nameNormalized).toBe("onion");
    expect(result.source).toBe("pantry");
  });
  it("accepts null quantity/unit/preparation/matches (unmatched purchase ingredient)", () => {
    const result = mealPlanIngredientSchema.parse({
      ...validIngredient,
      quantity: null,
      unit: null,
      preparation: null,
      matchedItemId: null,
      matchConfidence: null,
      source: "purchase",
    });
    expect(result.quantity).toBeNull();
    expect(result.source).toBe("purchase");
  });
  it("rejects a missing rawText", () => {
    const { rawText: _rawText, ...withoutRawText } = validIngredient;
    expect(() => mealPlanIngredientSchema.parse(withoutRawText)).toThrow();
  });
  it("rejects an invalid source enum value", () => {
    expect(() =>
      mealPlanIngredientSchema.parse({ ...validIngredient, source: "fridge" })
    ).toThrow();
  });
});

describe("mealPlanMealSchema", () => {
  it("accepts a meal without nested ingredients (list/summary shape)", () => {
    const result = mealPlanMealSchema.parse(validMeal);
    expect(result.ingredients).toBeUndefined();
  });
  it("accepts a meal with nested ingredients (detail shape)", () => {
    const result = mealPlanMealSchema.parse({
      ...validMeal,
      ingredients: [validIngredient],
    });
    expect(result.ingredients).toHaveLength(1);
  });
  it("accepts a pending meal with null summary/servings/times", () => {
    const result = mealPlanMealSchema.parse({
      ...validMeal,
      summary: null,
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
      instructions: [],
      detailStatus: "pending",
    });
    expect(result.instructions).toEqual([]);
  });
  it("rejects an invalid slot", () => {
    expect(() => mealPlanMealSchema.parse({ ...validMeal, slot: "brunch" })).toThrow();
  });
  it("rejects a non-array instructions field", () => {
    expect(() => mealPlanMealSchema.parse({ ...validMeal, instructions: "step one" })).toThrow();
  });
});

describe("mealPlanDaySchema", () => {
  it("accepts a day without nested meals (list/summary shape)", () => {
    const result = mealPlanDaySchema.parse(validDay);
    expect(result.meals).toBeUndefined();
  });
  it("accepts a day with nested meals (detail shape)", () => {
    const result = mealPlanDaySchema.parse({ ...validDay, meals: [validMeal] });
    expect(result.meals).toHaveLength(1);
  });
  it("accepts dayIndex at both boundaries (0 and 13)", () => {
    expect(mealPlanDaySchema.parse({ ...validDay, dayIndex: 0 }).dayIndex).toBe(0);
    expect(mealPlanDaySchema.parse({ ...validDay, dayIndex: 13 }).dayIndex).toBe(13);
  });
  it("rejects dayIndex out of the 0-13 range", () => {
    expect(() => mealPlanDaySchema.parse({ ...validDay, dayIndex: -1 })).toThrow();
    expect(() => mealPlanDaySchema.parse({ ...validDay, dayIndex: 14 })).toThrow();
  });
  it("rejects a full ISO datetime in date", () => {
    expect(() => mealPlanDaySchema.parse({ ...validDay, date: "2026-09-07T00:00:00Z" })).toThrow();
  });
});

describe("mealPlanSchema", () => {
  it("accepts a fully-populated summary row (no nested days)", () => {
    const result = mealPlanSchema.parse(validPlan);
    expect(result.days).toBeUndefined();
    expect(result.status).toBe("ready");
  });
  it("accepts a nested detail row (days -> meals -> ingredients)", () => {
    const result = mealPlanSchema.parse({
      ...validPlan,
      days: [{ ...validDay, meals: [{ ...validMeal, ingredients: [validIngredient] }] }],
    });
    expect(result.days?.[0]?.meals?.[0]?.ingredients?.[0]?.nameNormalized).toBe("onion");
  });
  it("accepts requestedBy as a non-uuid text id (users.id is text, not uuid)", () => {
    const result = mealPlanSchema.parse({ ...validPlan, requestedBy: "user_plain_text_id" });
    expect(result.requestedBy).toBe("user_plain_text_id");
  });
  it("accepts dayCount at both boundaries (1 and 14)", () => {
    expect(mealPlanSchema.parse({ ...validPlan, dayCount: 1 }).dayCount).toBe(1);
    expect(mealPlanSchema.parse({ ...validPlan, dayCount: 14 }).dayCount).toBe(14);
  });
  it("rejects dayCount outside 1-14", () => {
    expect(() => mealPlanSchema.parse({ ...validPlan, dayCount: 0 })).toThrow();
    expect(() => mealPlanSchema.parse({ ...validPlan, dayCount: 15 })).toThrow();
  });
  it("rejects an invalid status", () => {
    expect(() => mealPlanSchema.parse({ ...validPlan, status: "done" })).toThrow();
  });
  it("rejects a missing providerSnapshot/modelSnapshot", () => {
    const { providerSnapshot: _p, ...withoutProvider } = validPlan;
    expect(() => mealPlanSchema.parse(withoutProvider)).toThrow();
    const { modelSnapshot: _m, ...withoutModel } = validPlan;
    expect(() => mealPlanSchema.parse(withoutModel)).toThrow();
  });
});

describe("createMealPlanSchema", () => {
  const validCreate = {
    startDate: "2026-09-07",
    dayCount: 7,
    slots: ["dinner"],
    mode: "balanced",
  };

  it("accepts the minimal valid payload and defaults includeExpired to false", () => {
    const result = createMealPlanSchema.parse(validCreate);
    expect(result.includeExpired).toBe(false);
    expect(result.slots).toEqual(["dinner"]);
  });

  // `startDate` is optional — omitting it means "default to the household's
  // configured week start", computed server-side (lib/mealplan/schedule.ts). See
  // server/src/test/lib/mealplan/schedule.test.ts and routes/meal-plans.test.ts for
  // the actual day-selection coverage.
  it("accepts an omitted startDate", () => {
    const { startDate: _startDate, ...withoutStartDate } = validCreate;
    const result = createMealPlanSchema.parse(withoutStartDate);
    expect(result.startDate).toBeUndefined();
  });

  it("accepts all four slots, promptId, includeExpired, and notes", () => {
    const result = createMealPlanSchema.parse({
      ...validCreate,
      slots: ["breakfast", "lunch", "dinner", "snack"],
      mode: "expiring_first",
      promptId: UUID_A,
      includeExpired: true,
      notes: "no seafood this week",
    });
    expect(result.slots).toHaveLength(4);
    expect(result.includeExpired).toBe(true);
  });

  it("rejects an empty slots array", () => {
    expect(() => createMealPlanSchema.parse({ ...validCreate, slots: [] })).toThrow();
  });

  it("rejects more than four slots", () => {
    expect(() =>
      createMealPlanSchema.parse({
        ...validCreate,
        slots: ["breakfast", "lunch", "dinner", "snack", "breakfast"],
      })
    ).toThrow();
  });

  it("rejects duplicate slots", () => {
    expect(() =>
      createMealPlanSchema.parse({ ...validCreate, slots: ["dinner", "dinner"] })
    ).toThrow();
  });

  it("rejects dayCount outside 1-14", () => {
    expect(() => createMealPlanSchema.parse({ ...validCreate, dayCount: 0 })).toThrow();
    expect(() => createMealPlanSchema.parse({ ...validCreate, dayCount: 15 })).toThrow();
  });

  it("rejects a startDate that is a full ISO datetime, not a local date", () => {
    expect(() =>
      createMealPlanSchema.parse({ ...validCreate, startDate: "2026-09-07T00:00:00Z" })
    ).toThrow();
  });

  it("rejects a missing mode", () => {
    const { mode: _mode, ...withoutMode } = validCreate;
    expect(() => createMealPlanSchema.parse(withoutMode)).toThrow();
  });

  it("rejects notes over 500 characters", () => {
    expect(() => createMealPlanSchema.parse({ ...validCreate, notes: "x".repeat(501) })).toThrow();
  });
});

describe("updateMealPlanIngredientSchema", () => {
  it("accepts flipping to purchase", () => {
    expect(updateMealPlanIngredientSchema.parse({ source: "purchase" }).source).toBe("purchase");
  });
  it("accepts flipping to pantry", () => {
    expect(updateMealPlanIngredientSchema.parse({ source: "pantry" }).source).toBe("pantry");
  });
  it("rejects an invalid source", () => {
    expect(() => updateMealPlanIngredientSchema.parse({ source: "fridge" })).toThrow();
  });
  it("rejects a missing source", () => {
    expect(() => updateMealPlanIngredientSchema.parse({})).toThrow();
  });
});

describe("mealPlanShoppingStateSchema", () => {
  it("accepts have, have_expiring, must_buy", () => {
    expect(mealPlanShoppingStateSchema.parse("have")).toBe("have");
    expect(mealPlanShoppingStateSchema.parse("have_expiring")).toBe("have_expiring");
    expect(mealPlanShoppingStateSchema.parse("must_buy")).toBe("must_buy");
  });
  it("rejects an unknown state", () => {
    expect(() => mealPlanShoppingStateSchema.parse("unsure")).toThrow();
  });
});

describe("mealPlanShoppingUsedOnSchema", () => {
  const validUsedOn = { dayIndex: 2, recipeId: UUID_A, recipeTitle: "Onion Soup" };

  it("accepts a valid provenance entry", () => {
    expect(mealPlanShoppingUsedOnSchema.parse(validUsedOn).recipeTitle).toBe("Onion Soup");
  });
  it("rejects dayIndex out of range", () => {
    expect(() => mealPlanShoppingUsedOnSchema.parse({ ...validUsedOn, dayIndex: 14 })).toThrow();
  });
});

describe("mealPlanShoppingAggregateSchema", () => {
  const validAggregate = {
    nameNormalized: "onion",
    unit: "cup",
    quantityLabel: "2 cups + 1 unit",
    state: "must_buy" as const,
    ingredientIds: [UUID_A, UUID_B],
    usedOn: [{ dayIndex: 0, recipeId: UUID_C, recipeTitle: "Onion Soup" }],
    alreadyCommitted: false,
  };

  it("accepts a fully-populated aggregate", () => {
    const result = mealPlanShoppingAggregateSchema.parse(validAggregate);
    expect(result.quantityLabel).toBe("2 cups + 1 unit");
  });
  it("accepts a null unit (mixed/unspecified units)", () => {
    expect(
      mealPlanShoppingAggregateSchema.parse({ ...validAggregate, unit: null }).unit
    ).toBeNull();
  });
  it("rejects an empty ingredientIds array", () => {
    expect(() =>
      mealPlanShoppingAggregateSchema.parse({ ...validAggregate, ingredientIds: [] })
    ).toThrow();
  });
  it("rejects an invalid state", () => {
    expect(() =>
      mealPlanShoppingAggregateSchema.parse({ ...validAggregate, state: "unsure" })
    ).toThrow();
  });
});

describe("mealPlanShoppingListSchema", () => {
  it("accepts an empty items list", () => {
    const result = mealPlanShoppingListSchema.parse({ planId: UUID_A, items: [] });
    expect(result.items).toEqual([]);
  });
  it("rejects a missing planId", () => {
    expect(() => mealPlanShoppingListSchema.parse({ items: [] })).toThrow();
  });
});

describe("commitMealPlanShoppingSchema", () => {
  it("accepts an omitted ingredientIds (commit everything eligible)", () => {
    expect(commitMealPlanShoppingSchema.parse({}).ingredientIds).toBeUndefined();
  });
  it("accepts an explicit ingredientIds list", () => {
    const result = commitMealPlanShoppingSchema.parse({ ingredientIds: [UUID_A, UUID_B] });
    expect(result.ingredientIds).toHaveLength(2);
  });
  it("rejects an empty ingredientIds array", () => {
    expect(() => commitMealPlanShoppingSchema.parse({ ingredientIds: [] })).toThrow();
  });
});
