import { z } from "zod";

/**
 * Zod schemas for the two-phase meal-plan LLM generation (plan §2.2, §4.2).
 *
 * Every field carries `.describe()` — matching the house style set by
 * `server/src/lib/openai.ts`, that is where field documentation for the model lives,
 * not the user message. Array/string length caps live IN the schema so a runaway
 * generation cannot write an unbounded row (plan §4.5 "cost runaway").
 */

// ---------------------------------------------------------------------------------
// Phase 1 — one call, returns the whole week's meal skeleton (titles + summaries),
// no ingredients or steps yet. Concurrency-friendly and small enough to be reliable
// across arbitrary OpenRouter models.
// ---------------------------------------------------------------------------------

export const PlanSkeletonMealSchema = z.object({
  dayIndex: z
    .number()
    .int()
    .min(0)
    .max(13)
    .describe("Zero-based day offset from the plan's start date. 0 = the first day."),
  slot: z
    .enum(["breakfast", "lunch", "dinner", "snack"])
    .describe("Which meal slot of the day this is."),
  title: z
    .string()
    .max(120)
    .describe("Short, appetizing recipe title, e.g. 'Sheet-Pan Lemon Chicken with Broccoli'."),
  summary: z
    .string()
    .max(300)
    .describe(
      "One or two sentence description of the dish — enough for a household member to decide if they want it, without the full recipe."
    ),
  servings: z.number().int().positive().max(20).describe("Number of people this meal serves."),
  keyIngredients: z
    .array(z.string().max(60))
    .max(8)
    .describe(
      "The 3-8 headline ingredients that define this dish (bare nouns, e.g. 'chicken thighs', not full recipe ingredient lines). Used to preview the meal before full details are generated."
    ),
});

export const PlanSkeletonSchema = z.object({
  meals: z
    .array(PlanSkeletonMealSchema)
    .max(56)
    .describe(
      "Every meal for every requested day/slot combination, in any order (day/slot are disambiguated by the dayIndex and slot fields, not array position)."
    ),
});

export type PlanSkeletonMeal = z.infer<typeof PlanSkeletonMealSchema>;
export type PlanSkeleton = z.infer<typeof PlanSkeletonSchema>;

// ---------------------------------------------------------------------------------
// Phase 2 — one call per meal (concurrency 4), returns full recipe detail: timing,
// structured ingredients, and numbered steps. Isolating this per-meal means a single
// malformed recipe never discards the rest of the week (plan §2.2).
// ---------------------------------------------------------------------------------

export const RecipeIngredientSchema = z.object({
  name: z
    .string()
    .max(60)
    .describe(
      "Bare noun food name only, no quantity/unit/preparation words — e.g. 'onion', not '1 diced onion'. Quantity, unit, and preparation are separate fields."
    ),
  quantity: z
    .number()
    .nullable()
    .describe(
      "Numeric amount needed, or null if the ingredient has no meaningful quantity (e.g. 'salt to taste')."
    ),
  unit: z
    .string()
    .max(20)
    .nullable()
    .describe(
      "Unit of measure for quantity (e.g. 'cup', 'oz', 'clove'), or null if quantity is null or unitless."
    ),
  preparation: z
    .string()
    .max(60)
    .nullable()
    .describe(
      "Prep instruction for this ingredient, e.g. 'chopped', 'minced', 'room temperature', or null."
    ),
  optional: z
    .boolean()
    .describe("True if the recipe works without this ingredient (e.g. a garnish)."),
});

export const RecipeDetailSchema = z.object({
  prepMinutes: z
    .number()
    .int()
    .nonnegative()
    .max(600)
    .describe("Estimated active preparation time in minutes, before cooking starts."),
  cookMinutes: z
    .number()
    .int()
    .nonnegative()
    .max(600)
    .describe("Estimated cooking/baking time in minutes."),
  ingredients: z
    .array(RecipeIngredientSchema)
    .max(25)
    .describe("Every ingredient needed for this recipe at the stated servings."),
  steps: z
    .array(z.string().max(1000))
    .min(2)
    .max(20)
    .describe(
      "Numbered cooking steps in order, each a complete instruction (the array index IS the step number — do not prefix steps with numbers)."
    ),
});

export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;
export type RecipeDetail = z.infer<typeof RecipeDetailSchema>;
