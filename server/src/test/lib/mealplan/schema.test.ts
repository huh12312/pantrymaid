import { describe, test, expect } from "bun:test";
import {
  PlanSkeletonSchema,
  RecipeDetailSchema,
  type RecipeDetail,
} from "../../../lib/mealplan/schema";

describe("PlanSkeletonSchema", () => {
  test("accepts a valid skeleton", () => {
    const result = PlanSkeletonSchema.safeParse({
      meals: [
        {
          dayIndex: 0,
          slot: "dinner",
          title: "Sheet-Pan Lemon Chicken",
          summary: "Roasted chicken thighs with broccoli and lemon.",
          servings: 4,
          keyIngredients: ["chicken thighs", "broccoli", "lemon"],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects dayIndex out of range", () => {
    const result = PlanSkeletonSchema.safeParse({
      meals: [
        {
          dayIndex: 14,
          slot: "dinner",
          title: "x",
          summary: "x",
          servings: 2,
          keyIngredients: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("rejects an invalid slot", () => {
    const result = PlanSkeletonSchema.safeParse({
      meals: [
        {
          dayIndex: 0,
          slot: "brunch",
          title: "x",
          summary: "x",
          servings: 2,
          keyIngredients: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("caps meals array at 56 (bounds a runaway generation)", () => {
    const meals = Array.from({ length: 57 }, (_, i) => ({
      dayIndex: i % 14,
      slot: "dinner" as const,
      title: "x",
      summary: "x",
      servings: 2,
      keyIngredients: [],
    }));
    const result = PlanSkeletonSchema.safeParse({ meals });
    expect(result.success).toBe(false);
  });

  test("caps keyIngredients at 8 and title/summary lengths", () => {
    const tooManyIngredients = PlanSkeletonSchema.safeParse({
      meals: [
        {
          dayIndex: 0,
          slot: "dinner",
          title: "x",
          summary: "x",
          servings: 2,
          keyIngredients: Array.from({ length: 9 }, (_, i) => `ingredient-${i}`),
        },
      ],
    });
    expect(tooManyIngredients.success).toBe(false);

    const tooLongTitle = PlanSkeletonSchema.safeParse({
      meals: [
        {
          dayIndex: 0,
          slot: "dinner",
          title: "x".repeat(121),
          summary: "x",
          servings: 2,
          keyIngredients: [],
        },
      ],
    });
    expect(tooLongTitle.success).toBe(false);
  });
});

describe("RecipeDetailSchema", () => {
  function validRecipe(): RecipeDetail {
    return {
      prepMinutes: 10,
      cookMinutes: 25,
      ingredients: [
        { name: "onion", quantity: 1, unit: "unit", preparation: "diced", optional: false },
      ],
      steps: ["Dice the onion.", "Cook the onion until soft."],
    };
  }

  test("accepts a valid recipe", () => {
    expect(RecipeDetailSchema.safeParse(validRecipe()).success).toBe(true);
  });

  test("allows null quantity/unit/preparation", () => {
    const recipe = validRecipe();
    recipe.ingredients[0] = {
      name: "salt",
      quantity: null,
      unit: null,
      preparation: null,
      optional: false,
    };
    expect(RecipeDetailSchema.safeParse(recipe).success).toBe(true);
  });

  test("requires at least 2 steps", () => {
    const recipe = validRecipe();
    recipe.steps = ["Just one step."];
    expect(RecipeDetailSchema.safeParse(recipe).success).toBe(false);
  });

  test("caps steps at 20 and ingredients at 25", () => {
    const tooManySteps = validRecipe();
    tooManySteps.steps = Array.from({ length: 21 }, (_, i) => `Step ${i}`);
    expect(RecipeDetailSchema.safeParse(tooManySteps).success).toBe(false);

    const tooManyIngredients = validRecipe();
    tooManyIngredients.ingredients = Array.from({ length: 26 }, () => ({
      name: "onion",
      quantity: 1,
      unit: "unit",
      preparation: null,
      optional: false,
    }));
    expect(RecipeDetailSchema.safeParse(tooManyIngredients).success).toBe(false);
  });

  test("rejects negative prep/cook minutes and out-of-range values", () => {
    expect(RecipeDetailSchema.safeParse({ ...validRecipe(), prepMinutes: -1 }).success).toBe(false);
    expect(RecipeDetailSchema.safeParse({ ...validRecipe(), cookMinutes: 601 }).success).toBe(
      false
    );
  });
});
