import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createMealPlanSchema,
  updateMealPlanIngredientSchema,
  commitMealPlanShoppingSchema,
  createMealPlanPromptSchema,
  updateMealPlanPromptSchema,
} from "@pantrymaid/shared/schemas";
import type {
  CreateMealPlanInput,
  UpdateMealPlanIngredientInput,
  CommitMealPlanShoppingInput,
  CreateMealPlanPromptInput,
  UpdateMealPlanPromptInput,
} from "@pantrymaid/shared/schemas";
import { authMiddleware, getUser } from "../middleware/auth";
import { checkAndRecordGenerationLimit } from "../lib/generationLimits";
import { db } from "../lib/db";
import {
  mealPlans,
  mealPlanDays,
  mealPlanMeals,
  mealPlanIngredients,
  mealPlanPrompts,
  householdLlmSettings,
  shoppingListItems,
  items as itemsTable,
} from "../db/schema";
import { eq, and, gte, inArray, desc, sql as drizzleSql } from "drizzle-orm";
import { runGeneration, regenerateMeal } from "../lib/mealplan/generate";
import { resolveLLMConfigPreview, type HouseholdLLMProvider } from "../lib/llm";
import { computeDefaultMealPlanStartDate } from "../lib/mealplan/schedule";
import { normalizeIngredientName } from "../lib/ingredients";
import { DEFAULT_USER_PROMPT_TEMPLATE, type PantryItem } from "../lib/mealplan/prompt";
import {
  buildPantryIndex,
  matchIngredient,
  classifySource,
  type IngredientSource,
} from "../lib/mealplan/reconcile";

type MealPlanRow = typeof mealPlans.$inferSelect;
type MealPlanDayRow = typeof mealPlanDays.$inferSelect;
type MealPlanMealRow = typeof mealPlanMeals.$inferSelect;
type MealPlanIngredientRow = typeof mealPlanIngredients.$inferSelect;
type MealPlanPromptRow = typeof mealPlanPrompts.$inferSelect;

/**
 * Maps a rejected generation-limit scope (plan §6.5: 5/hour, 30/day, Postgres-backed
 * so a restart doesn't reset it — see lib/generationLimits.ts) to a user-facing 429.
 */
function generationLimitResponse(scope: "hourly" | "daily") {
  const message =
    scope === "hourly"
      ? "Generation rate limit reached (5/hour) — try again later"
      : "Daily generation limit reached (30/day) — try again tomorrow";
  return { success: false as const, error: message, code: "generation_rate_limited" as const };
}

/**
 * Sums `input_tokens + output_tokens` across this household's meal_plans rows created
 * this calendar month (UTC) — the pre-flight input to the `monthly_token_cap` check
 * below (plan §4.5, §11 Q6).
 */
async function getMonthlyTokenUsage(householdId: string, now: Date = new Date()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [row] = await db
    .select({
      total: drizzleSql<string>`COALESCE(SUM(COALESCE(${mealPlans.inputTokens}, 0) + COALESCE(${mealPlans.outputTokens}, 0)), 0)`,
    })
    .from(mealPlans)
    .where(and(eq(mealPlans.householdId, householdId), gte(mealPlans.createdAt, monthStart)));

  return Number(row?.total ?? 0);
}

/**
 * Pre-flight `household_llm_settings.monthly_token_cap` check (null = uncapped).
 * `monthlyTokenCap` is null-safe here so callers can pass the already-fetched settings
 * row's value without a second settings query.
 */
async function isMonthlyTokenCapExceeded(
  householdId: string,
  monthlyTokenCap: number | null,
  now: Date = new Date()
): Promise<boolean> {
  if (monthlyTokenCap === null) return false;
  const used = await getMonthlyTokenUsage(householdId, now);
  return used >= monthlyTokenCap;
}

const MONTHLY_TOKEN_CAP_RESPONSE = {
  success: false as const,
  error: "Monthly token cap reached for this household — adjust it in Settings",
  code: "monthly_token_cap_exceeded" as const,
};

function hasUniqueViolationCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Postgres unique-violation (23505) check. drizzle-orm's postgres-js driver wraps the
 * raw `postgres` package error (which carries `.code`) in a `DrizzleQueryError` whose
 * own `.cause` is that raw error — so the code must be checked on `.cause`, not on the
 * thrown error itself.
 */
function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) return true;
  const cause = error instanceof Error ? error.cause : undefined;
  return hasUniqueViolationCode(cause);
}

function serializeIngredient(row: MealPlanIngredientRow) {
  return {
    ...row,
    quantity: row.quantity !== null ? Number(row.quantity) : null,
    matchConfidence: row.matchConfidence !== null ? Number(row.matchConfidence) : null,
  };
}

function serializeMealPlanSummary(row: MealPlanRow) {
  return {
    ...row,
    priorityCoverage: row.priorityCoverage !== null ? Number(row.priorityCoverage) : null,
  };
}

function serializePrompt(row: MealPlanPromptRow) {
  return row;
}

const mealPlansRoute = new Hono();
mealPlansRoute.use("*", authMiddleware);

// ---------------------------------------------------------------------------------
// Prompt CRUD — GET/POST/PATCH/DELETE /prompts[/:id] (plan §4.4). Mounted BEFORE
// the /:id routes below so "/prompts" never gets swallowed by the `:id` param match.
// ---------------------------------------------------------------------------------

mealPlansRoute.get("/prompts", async (c) => {
  try {
    const user = getUser(c);
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const rows = await db
      .select()
      .from(mealPlanPrompts)
      .where(eq(mealPlanPrompts.householdId, user.householdId))
      .orderBy(desc(mealPlanPrompts.updatedAt));
    return c.json({ success: true, data: rows.map(serializePrompt) });
  } catch (error) {
    console.error("Error fetching meal plan prompts:", error);
    return c.json({ success: false, error: "Failed to fetch prompts" }, 500);
  }
});

mealPlansRoute.post("/prompts", zValidator("json", createMealPlanPromptSchema), async (c) => {
  try {
    const user = getUser(c);
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const data = c.req.valid("json") as CreateMealPlanPromptInput;
    const householdId = user.householdId;

    const created = await db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx
          .update(mealPlanPrompts)
          .set({ isDefault: false })
          .where(
            and(eq(mealPlanPrompts.householdId, householdId), eq(mealPlanPrompts.isDefault, true))
          );
      }
      const [row] = await tx
        .insert(mealPlanPrompts)
        .values({
          householdId,
          name: data.name,
          body: data.body,
          isDefault: data.isDefault ?? false,
          updatedBy: user.id,
        })
        .returning();
      return row;
    });

    if (!created) {
      return c.json({ success: false, error: "Failed to create prompt" }, 500);
    }
    return c.json({ success: true, data: serializePrompt(created) }, 201);
  } catch (error) {
    console.error("Error creating meal plan prompt:", error);
    return c.json({ success: false, error: "Failed to create prompt" }, 500);
  }
});

mealPlansRoute.patch(
  "/prompts/:promptId",
  zValidator("json", updateMealPlanPromptSchema),
  async (c) => {
    try {
      const user = getUser(c);
      const promptId = c.req.param("promptId");
      if (!user.householdId) {
        return c.json({ success: false, error: "User must belong to a household" }, 403);
      }
      const data = c.req.valid("json") as UpdateMealPlanPromptInput;
      const householdId = user.householdId;

      const updated = await db.transaction(async (tx) => {
        if (data.isDefault) {
          await tx
            .update(mealPlanPrompts)
            .set({ isDefault: false })
            .where(
              and(eq(mealPlanPrompts.householdId, householdId), eq(mealPlanPrompts.isDefault, true))
            );
        }
        const [row] = await tx
          .update(mealPlanPrompts)
          .set({ ...data, updatedBy: user.id, updatedAt: new Date() })
          .where(
            and(eq(mealPlanPrompts.id, promptId), eq(mealPlanPrompts.householdId, householdId))
          )
          .returning();
        return row;
      });

      if (!updated) {
        return c.json({ success: false, error: "Prompt not found" }, 404);
      }
      return c.json({ success: true, data: serializePrompt(updated) });
    } catch (error) {
      console.error("Error updating meal plan prompt:", error);
      return c.json({ success: false, error: "Failed to update prompt" }, 500);
    }
  }
);

mealPlansRoute.delete("/prompts/:promptId", async (c) => {
  try {
    const user = getUser(c);
    const promptId = c.req.param("promptId");
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const result = await db
      .delete(mealPlanPrompts)
      .where(
        and(eq(mealPlanPrompts.id, promptId), eq(mealPlanPrompts.householdId, user.householdId))
      )
      .returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Prompt not found" }, 404);
    }
    return c.json({ success: true, data: null });
  } catch (error) {
    console.error("Error deleting meal plan prompt:", error);
    return c.json({ success: false, error: "Failed to delete prompt" }, 500);
  }
});

// ---------------------------------------------------------------------------------
// POST / — insert `queued`, rely on the `one_active` partial unique index for the
// concurrency guarantee (plan §4.1). 23505 -> 409, never read-then-write.
// ---------------------------------------------------------------------------------

mealPlansRoute.post("/", zValidator("json", createMealPlanSchema), async (c) => {
  try {
    const user = getUser(c);
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const householdId = user.householdId;
    const data = c.req.valid("json") as CreateMealPlanInput;

    const [settings] = await db
      .select()
      .from(householdLlmSettings)
      .where(eq(householdLlmSettings.householdId, householdId));

    // A household with no key of its own still generates fine off the container-wide
    // env key for its resolved provider (plan §4.5) — resolveLLMConfigPreview is the
    // non-decrypting check, since all we need here is "is a key available", not the
    // key itself (that is re-resolved, with decryption, by runGeneration).
    const configPreview = resolveLLMConfigPreview({
      provider: (settings?.provider as HouseholdLLMProvider | undefined) ?? null,
      model: settings?.model ?? null,
      hasHouseholdKey: Boolean(settings?.apiKeyCiphertext),
    });
    if (!configPreview) {
      return c.json(
        { success: false, error: "Configure an AI provider and API key in Settings first" },
        400
      );
    }

    if (await isMonthlyTokenCapExceeded(householdId, settings?.monthlyTokenCap ?? null)) {
      return c.json(MONTHLY_TOKEN_CAP_RESPONSE, 429);
    }

    // Postgres-backed hourly+daily generation budget (plan §6.5) — keyed on the
    // session's householdId, never a spoofable request header, and persisted so a
    // restart doesn't refill it. See lib/generationLimits.ts.
    const { allowed, scope } = await checkAndRecordGenerationLimit(householdId);
    if (!allowed) {
      return c.json(generationLimitResponse(scope!), 429);
    }

    let promptBody = DEFAULT_USER_PROMPT_TEMPLATE;
    let promptId: string | null = null;
    if (data.promptId) {
      const [prompt] = await db
        .select()
        .from(mealPlanPrompts)
        .where(
          and(eq(mealPlanPrompts.id, data.promptId), eq(mealPlanPrompts.householdId, householdId))
        );
      if (!prompt) {
        return c.json({ success: false, error: "Prompt not found" }, 404);
      }
      promptBody = prompt.body;
      promptId = prompt.id;
    } else {
      const [defaultPrompt] = await db
        .select()
        .from(mealPlanPrompts)
        .where(
          and(eq(mealPlanPrompts.householdId, householdId), eq(mealPlanPrompts.isDefault, true))
        );
      if (defaultPrompt) {
        promptBody = defaultPrompt.body;
        promptId = defaultPrompt.id;
      }
    }

    const progressTotal = data.dayCount * data.slots.length;

    // `startDate` is optional (plan §11 bugfix: week_start_day had zero consumers).
    // When omitted, default to the household's configured week start — never a past
    // date — instead of silently meaning "today" regardless of that setting.
    const startDate =
      data.startDate ??
      computeDefaultMealPlanStartDate(
        settings?.weekStartDay ?? 1,
        settings?.timezone ?? "America/New_York",
        new Date()
      );

    let created: MealPlanRow | undefined;
    try {
      [created] = await db
        .insert(mealPlans)
        .values({
          householdId,
          startDate,
          dayCount: data.dayCount,
          mode: data.mode,
          includeExpired: data.includeExpired,
          status: "queued",
          progressDone: 0,
          progressTotal,
          promptId,
          promptSnapshot: promptBody,
          providerSnapshot: configPreview.provider,
          modelSnapshot: configPreview.model,
          requestedBy: user.id,
          heartbeatAt: new Date(),
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        return c.json(
          { success: false, error: "A meal plan is already generating for this household" },
          409
        );
      }
      throw error;
    }

    if (!created) {
      return c.json({ success: false, error: "Failed to create meal plan" }, 500);
    }

    const planId = created.id;
    void runGeneration(planId, data.slots).catch((error: unknown) => {
      console.error("Meal plan generation failed unexpectedly:", planId, error);
    });

    return c.json({ success: true, data: { id: created.id, status: created.status } }, 202);
  } catch (error) {
    console.error("Error creating meal plan:", error);
    return c.json({ success: false, error: "Failed to create meal plan" }, 500);
  }
});

// GET / — summaries, paginated, no nesting (plan §4.4).
mealPlansRoute.get("/", async (c) => {
  try {
    const user = getUser(c);
    if (!user.householdId) {
      return c.json({ success: true, data: { items: [], total: 0 } });
    }
    const householdId = user.householdId;

    const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
    const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") ?? "20") || 20));

    const rows = await db
      .select()
      .from(mealPlans)
      .where(eq(mealPlans.householdId, householdId))
      .orderBy(desc(mealPlans.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return c.json({
      success: true,
      data: { items: rows.map(serializeMealPlanSummary), page, pageSize },
    });
  } catch (error) {
    console.error("Error fetching meal plans:", error);
    return c.json({ success: false, error: "Failed to fetch meal plans" }, 500);
  }
});

// GET /:id — full nested days -> meals -> ingredients + status/progress (plan §4.4).
// This is the polling endpoint; three flat queries (no N+1), assembled in code.
mealPlansRoute.get("/:id", async (c) => {
  try {
    const user = getUser(c);
    const planId = c.req.param("id");
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const householdId = user.householdId;

    const [plan] = await db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.id, planId), eq(mealPlans.householdId, householdId)));
    if (!plan) {
      return c.json({ success: false, error: "Meal plan not found" }, 404);
    }

    const dayRows: MealPlanDayRow[] = await db
      .select()
      .from(mealPlanDays)
      .where(and(eq(mealPlanDays.planId, planId), eq(mealPlanDays.householdId, householdId)));

    const mealRows: MealPlanMealRow[] = await db
      .select()
      .from(mealPlanMeals)
      .where(and(eq(mealPlanMeals.planId, planId), eq(mealPlanMeals.householdId, householdId)));

    const mealIds = mealRows.map((m) => m.id);
    const ingredientRows: MealPlanIngredientRow[] =
      mealIds.length > 0
        ? await db
            .select()
            .from(mealPlanIngredients)
            .where(
              and(
                eq(mealPlanIngredients.householdId, householdId),
                inArray(mealPlanIngredients.mealId, mealIds)
              )
            )
        : [];

    const ingredientsByMealId = new Map<string, MealPlanIngredientRow[]>();
    for (const ing of ingredientRows) {
      const list = ingredientsByMealId.get(ing.mealId);
      if (list) list.push(ing);
      else ingredientsByMealId.set(ing.mealId, [ing]);
    }

    const mealsByDayId = new Map<string, MealPlanMealRow[]>();
    for (const meal of mealRows) {
      const list = mealsByDayId.get(meal.dayId);
      if (list) list.push(meal);
      else mealsByDayId.set(meal.dayId, [meal]);
    }

    const days = dayRows
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map((day) => ({
        ...day,
        meals: (mealsByDayId.get(day.id) ?? [])
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((meal) => ({
            ...meal,
            ingredients: (ingredientsByMealId.get(meal.id) ?? [])
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map(serializeIngredient),
          })),
      }));

    return c.json({ success: true, data: { ...serializeMealPlanSummary(plan), days } });
  } catch (error) {
    console.error("Error fetching meal plan:", error);
    return c.json({ success: false, error: "Failed to fetch meal plan" }, 500);
  }
});

// POST /:id/cancel — cooperative cancellation (plan §4.1, §4.5).
mealPlansRoute.post("/:id/cancel", async (c) => {
  try {
    const user = getUser(c);
    const planId = c.req.param("id");
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const [updated] = await db
      .update(mealPlans)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(mealPlans.id, planId), eq(mealPlans.householdId, user.householdId)))
      .returning();
    if (!updated) {
      return c.json({ success: false, error: "Meal plan not found" }, 404);
    }
    return c.json({ success: true, data: serializeMealPlanSummary(updated) });
  } catch (error) {
    console.error("Error cancelling meal plan:", error);
    return c.json({ success: false, error: "Failed to cancel meal plan" }, 500);
  }
});

// POST /:id/meals/:mealId/regenerate — 202, single meal (plan §11 Q7).
mealPlansRoute.post("/:id/meals/:mealId/regenerate", async (c) => {
  try {
    const user = getUser(c);
    const planId = c.req.param("id");
    const mealId = c.req.param("mealId");
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const householdId = user.householdId;

    const [plan] = await db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.id, planId), eq(mealPlans.householdId, householdId)));
    if (!plan) {
      return c.json({ success: false, error: "Meal plan not found" }, 404);
    }

    // Confirm the meal exists and belongs to THIS plan/household before consuming any
    // rate-limit budget or mutating state — an IDOR probe against a foreign/missing
    // meal must 404 without side effects, same as every other endpoint here.
    const [meal] = await db
      .select({ id: mealPlanMeals.id })
      .from(mealPlanMeals)
      .where(
        and(
          eq(mealPlanMeals.id, mealId),
          eq(mealPlanMeals.planId, planId),
          eq(mealPlanMeals.householdId, householdId)
        )
      );
    if (!meal) {
      return c.json({ success: false, error: "Meal not found" }, 404);
    }

    // Regenerate is a real phase-2 LLM call billed to the household's key — it draws
    // from the SAME budget as full-plan generation, so it must be rate-limited too, or
    // a trivial per-meal regenerate loop bypasses the 5/hour, 30/day cost control
    // entirely (plan §6.5). Checked BEFORE flipping detailStatus to "pending" so a
    // rejected request never leaves the meal stuck in a pending state with no worker
    // ever dispatched to clear it.
    const [settings] = await db
      .select({ monthlyTokenCap: householdLlmSettings.monthlyTokenCap })
      .from(householdLlmSettings)
      .where(eq(householdLlmSettings.householdId, householdId));

    if (await isMonthlyTokenCapExceeded(householdId, settings?.monthlyTokenCap ?? null)) {
      return c.json(MONTHLY_TOKEN_CAP_RESPONSE, 429);
    }

    const { allowed, scope } = await checkAndRecordGenerationLimit(householdId);
    if (!allowed) {
      return c.json(generationLimitResponse(scope!), 429);
    }

    const [updated] = await db
      .update(mealPlanMeals)
      .set({ detailStatus: "pending", detailError: null })
      .where(
        and(
          eq(mealPlanMeals.id, mealId),
          eq(mealPlanMeals.planId, planId),
          eq(mealPlanMeals.householdId, householdId)
        )
      )
      .returning();
    if (!updated) {
      return c.json({ success: false, error: "Meal not found" }, 404);
    }

    void regenerateMeal(planId, mealId).catch((error: unknown) => {
      console.error("Meal regeneration failed unexpectedly:", planId, mealId, error);
    });

    return c.json({ success: true, data: { id: mealId, detailStatus: "pending" } }, 202);
  } catch (error) {
    console.error("Error regenerating meal:", error);
    return c.json({ success: false, error: "Failed to regenerate meal" }, 500);
  }
});

// PATCH /:id/ingredients/:ingId — flip have<->buy (plan §4.4, §3).
mealPlansRoute.patch(
  "/:id/ingredients/:ingId",
  zValidator("json", updateMealPlanIngredientSchema),
  async (c) => {
    try {
      const user = getUser(c);
      const planId = c.req.param("id");
      const ingId = c.req.param("ingId");
      if (!user.householdId) {
        return c.json({ success: false, error: "User must belong to a household" }, 403);
      }
      const householdId = user.householdId;
      const data = c.req.valid("json") as UpdateMealPlanIngredientInput;

      // Verify the ingredient belongs to THIS plan and household in one statement —
      // meal_plan_ingredients carries household_id directly (denormalized, plan §3),
      // and joining meal_plan_meals confirms it belongs to :id, not just this household.
      const [row] = await db
        .select({ ingredientId: mealPlanIngredients.id })
        .from(mealPlanIngredients)
        .innerJoin(mealPlanMeals, eq(mealPlanIngredients.mealId, mealPlanMeals.id))
        .where(
          and(
            eq(mealPlanIngredients.id, ingId),
            eq(mealPlanIngredients.householdId, householdId),
            eq(mealPlanMeals.planId, planId)
          )
        );

      if (!row) {
        return c.json({ success: false, error: "Ingredient not found" }, 404);
      }

      const [updated] = await db
        .update(mealPlanIngredients)
        .set({ source: data.source, sourceOverridden: true })
        .where(
          and(eq(mealPlanIngredients.id, ingId), eq(mealPlanIngredients.householdId, householdId))
        )
        .returning();

      if (!updated) {
        return c.json({ success: false, error: "Ingredient not found" }, 404);
      }
      return c.json({ success: true, data: serializeIngredient(updated) });
    } catch (error) {
      console.error("Error updating ingredient:", error);
      return c.json({ success: false, error: "Failed to update ingredient" }, 500);
    }
  }
);

// GET /:id/shopping — deduped purchase list + alreadyCommitted (plan §4.4).
mealPlansRoute.get("/:id/shopping", async (c) => {
  try {
    const user = getUser(c);
    const planId = c.req.param("id");
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const householdId = user.householdId;

    const [plan] = await db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.id, planId), eq(mealPlans.householdId, householdId)));
    if (!plan) {
      return c.json({ success: false, error: "Meal plan not found" }, 404);
    }

    const mealRows = await db
      .select({ id: mealPlanMeals.id, dayIndex: mealPlanDays.dayIndex, title: mealPlanMeals.title })
      .from(mealPlanMeals)
      .innerJoin(mealPlanDays, eq(mealPlanMeals.dayId, mealPlanDays.id))
      .where(and(eq(mealPlanMeals.planId, planId), eq(mealPlanMeals.householdId, householdId)));
    const mealMeta = new Map(mealRows.map((m) => [m.id, m]));
    const mealIds = mealRows.map((m) => m.id);

    const ingredientRows: MealPlanIngredientRow[] =
      mealIds.length > 0
        ? await db
            .select()
            .from(mealPlanIngredients)
            .where(
              and(
                eq(mealPlanIngredients.householdId, householdId),
                inArray(mealPlanIngredients.mealId, mealIds),
                eq(mealPlanIngredients.source, "purchase")
              )
            )
        : [];

    const groups = new Map<
      string,
      {
        unit: string | null;
        ingredientIds: string[];
        usedOn: { dayIndex: number; recipeId: string; recipeTitle: string }[];
        alreadyCommitted: boolean;
      }
    >();

    for (const ing of ingredientRows) {
      const key = ing.nameNormalized;
      let group = groups.get(key);
      if (!group) {
        group = { unit: ing.unit, ingredientIds: [], usedOn: [], alreadyCommitted: false };
        groups.set(key, group);
      }
      group.ingredientIds.push(ing.id);
      if (ing.shoppingListItemId) group.alreadyCommitted = true;
      const meta = mealMeta.get(ing.mealId);
      if (meta) {
        group.usedOn.push({ dayIndex: meta.dayIndex, recipeId: meta.id, recipeTitle: meta.title });
      }
    }

    const items = Array.from(groups.entries())
      .map(([nameNormalized, group]) => ({
        nameNormalized,
        unit: group.unit,
        quantityLabel: group.unit ?? "unit",
        state: "must_buy" as const,
        ingredientIds: group.ingredientIds,
        usedOn: group.usedOn,
        alreadyCommitted: group.alreadyCommitted,
      }))
      .sort((a, b) => a.nameNormalized.localeCompare(b.nameNormalized));

    return c.json({ success: true, data: { planId, items } });
  } catch (error) {
    console.error("Error fetching meal plan shopping list:", error);
    return c.json({ success: false, error: "Failed to fetch shopping list" }, 500);
  }
});

// POST /:id/shopping/commit — creates shopping_list_items rows (origin='meal_plan'),
// deduped by name_normalized across the plan AND against existing pending rows so
// re-tapping never double-adds (plan §4.4). Shopping rows are created ONLY here.
//
// Eligibility is re-derived from LIVE inventory on every call, never trusted from the
// persisted `mealPlanIngredients.source` column — that column is written once at
// generation time and never re-evaluated, so an ingredient matched to a pantry item
// the household has since consumed (or deleted) would otherwise stay stuck as
// "pantry" forever and silently never get added when the user taps commit. An
// explicit user override (`sourceOverridden`) still wins over the live
// re-derivation — that is the whole point of the override — and reuses the exact
// same classification (`classifySource`/`matchIngredient`/`buildPantryIndex` from
// reconcile.ts) that generation itself uses, so there is only ever one matcher.
mealPlansRoute.post(
  "/:id/shopping/commit",
  zValidator("json", commitMealPlanShoppingSchema),
  async (c) => {
    try {
      const user = getUser(c);
      const planId = c.req.param("id");
      if (!user.householdId) {
        return c.json({ success: false, error: "User must belong to a household" }, 403);
      }
      const householdId = user.householdId;
      const data = c.req.valid("json") as CommitMealPlanShoppingInput;

      const [plan] = await db
        .select()
        .from(mealPlans)
        .where(and(eq(mealPlans.id, planId), eq(mealPlans.householdId, householdId)));
      if (!plan) {
        return c.json({ success: false, error: "Meal plan not found" }, 404);
      }

      const mealRows = await db
        .select({ id: mealPlanMeals.id })
        .from(mealPlanMeals)
        .where(and(eq(mealPlanMeals.planId, planId), eq(mealPlanMeals.householdId, householdId)));
      const mealIds = mealRows.map((m) => m.id);
      if (mealIds.length === 0) {
        return c.json({ success: true, data: { created: 0, skipped: 0 } });
      }

      // Candidate rows: every ingredient on this plan regardless of its persisted
      // `source` — that column is stale by design (see comment above). Eligibility is
      // decided below, from live data, not by this WHERE clause.
      const conditions = [
        eq(mealPlanIngredients.householdId, householdId),
        inArray(mealPlanIngredients.mealId, mealIds),
      ];
      if (data.ingredientIds && data.ingredientIds.length > 0) {
        conditions.push(inArray(mealPlanIngredients.id, data.ingredientIds));
      }

      const candidates: MealPlanIngredientRow[] = await db
        .select()
        .from(mealPlanIngredients)
        .where(and(...conditions));

      // Live pantry index, rebuilt fresh for this request (plan §2.3's have/buy
      // matcher) — never the frozen `matchedItemId`/`source` written at generation
      // time.
      const itemRows = await db
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.householdId, householdId));
      const pantryItems: PantryItem[] = itemRows.map((row) => ({
        id: row.id,
        name: row.name,
        quantity: Number(row.quantity),
        unit: row.unit,
        location: row.location,
        category: row.category,
        expirationDate: row.expirationDate,
        opened: row.opened,
      }));
      const pantryIndex = buildPantryIndex(pantryItems);

      // Requested-but-not-eligible count (excluding rows already linked to a shopping
      // row, which are a legitimate no-op, not something to warn about) — returned so
      // the client can tell the user WHY fewer rows were created than requested,
      // instead of a bare "Added 0 items" with no explanation.
      let skipped = 0;
      const eligible: MealPlanIngredientRow[] = [];
      for (const ing of candidates) {
        if (ing.shoppingListItemId) continue; // already committed; nothing to do

        const effectiveSource: IngredientSource = ing.sourceOverridden
          ? (ing.source as IngredientSource)
          : classifySource(ing.nameNormalized, matchIngredient(ing.nameNormalized, pantryIndex));

        if (effectiveSource === "purchase") {
          eligible.push(ing);
        } else {
          skipped += 1;
        }
      }

      // Dedupe within the plan by nameNormalized (an ingredient used by 5 meals is one row).
      const byName = new Map<string, MealPlanIngredientRow[]>();
      for (const ing of eligible) {
        const list = byName.get(ing.nameNormalized);
        if (list) list.push(ing);
        else byName.set(ing.nameNormalized, [ing]);
      }

      if (byName.size === 0) {
        return c.json({ success: true, data: { created: 0, skipped } });
      }

      // Dedupe against existing pending shopping_list_items rows (any origin).
      const existingPending = await db
        .select()
        .from(shoppingListItems)
        .where(
          and(
            eq(shoppingListItems.householdId, householdId),
            eq(shoppingListItems.status, "pending")
          )
        );
      const existingByNormalizedName = new Map(
        existingPending.map((row) => [normalizeIngredientName(row.name), row])
      );

      let created = 0;
      for (const [nameNormalized, rows] of byName) {
        const existing = existingByNormalizedName.get(nameNormalized);
        let shoppingListItemId: string;

        if (existing) {
          shoppingListItemId = existing.id;
        } else {
          const [inserted] = await db
            .insert(shoppingListItems)
            .values({
              householdId,
              name: nameNormalized,
              unit: rows[0]!.unit,
              suggestedQty: rows[0]!.quantity ?? "1",
              status: "pending",
              addedBy: user.id,
              origin: "meal_plan",
            })
            .returning();
          if (!inserted) continue;
          shoppingListItemId = inserted.id;
          created += 1;
          existingByNormalizedName.set(nameNormalized, inserted);
        }

        await db
          .update(mealPlanIngredients)
          .set({ shoppingListItemId })
          .where(
            and(
              eq(mealPlanIngredients.householdId, householdId),
              inArray(
                mealPlanIngredients.id,
                rows.map((r) => r.id)
              )
            )
          );
      }

      return c.json({ success: true, data: { created, skipped } });
    } catch (error) {
      console.error("Error committing meal plan shopping list:", error);
      return c.json({ success: false, error: "Failed to commit shopping list" }, 500);
    }
  }
);

// DELETE /:id
mealPlansRoute.delete("/:id", async (c) => {
  try {
    const user = getUser(c);
    const planId = c.req.param("id");
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const result = await db
      .delete(mealPlans)
      .where(and(eq(mealPlans.id, planId), eq(mealPlans.householdId, user.householdId)))
      .returning();
    if (result.length === 0) {
      return c.json({ success: false, error: "Meal plan not found" }, 404);
    }
    return c.json({ success: true, data: null });
  } catch (error) {
    console.error("Error deleting meal plan:", error);
    return c.json({ success: false, error: "Failed to delete meal plan" }, 500);
  }
});

export default mealPlansRoute;
