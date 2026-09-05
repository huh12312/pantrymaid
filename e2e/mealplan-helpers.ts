import type { Page, Route } from "@playwright/test";
import fixturePlanJson from "./fixtures/meal-plan.json";

/**
 * Layer 1 of the meal-plan e2e stubbing strategy (plan §8): intercept the API
 * responses with `page.route`/`route.fulfill`, following the exact idiom
 * `receipt.spec.ts` uses for `**\/api/receipt`. This is enough for every UI-only
 * spec in `mealplan.spec.ts`/`a11y.spec.ts`/`mobile.spec.ts` — none of them need a
 * real LLM call or even a real meal-plan row. The one spec that DOES need real
 * persistence (proving the route + `reconcile.ts` actually write rows) does not use
 * this helper at all; it relies on Layer 2, the `MEAL_PLAN_FIXTURE` server-side hook
 * in `server/src/lib/mealplan/generate.ts`.
 */

type JsonRecord = Record<string, unknown>;

interface FixtureDay extends JsonRecord {
  meals: JsonRecord[];
}

/** The minimal shape this helper needs from a plan fixture — deliberately loose
 * (`JsonRecord` index signature) everywhere else, since the fixture is asserted
 * against by the UI, not by this file. */
export interface FixturePlan extends JsonRecord {
  id: string;
  days: FixtureDay[];
}

export const FIXTURE_PLAN = fixturePlanJson as FixturePlan;
export const FIXTURE_PLAN_ID: string = FIXTURE_PLAN.id;

async function fulfillJson(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  });
}

/** Strips `days`, matching the real `GET /api/meal-plans` summary shape (plan §4.4: "no nesting"). */
function toSummary(plan: FixturePlan): JsonRecord {
  const { days: _days, ...summary } = plan;
  return summary;
}

export interface StubMealPlanApiOptions {
  /** Whether the household already has an AI provider key configured. Default true. */
  keyConfigured?: boolean;
  /** Whether a plan already exists before any `POST /api/meal-plans` call. Default true. */
  initialPlanExists?: boolean;
  /**
   * The plan `GET /api/meal-plans/:id` returns once a plan exists. Defaults to the
   * realistic 7-day fixture (`fixtures/meal-plan.json`). MUST keep the same `id` as
   * the default fixture — every other route below is keyed off `FIXTURE_PLAN_ID`.
   */
  plan?: FixturePlan;
  /**
   * When true, the FIRST poll of `GET /api/meal-plans/:id` after a `POST` returns an
   * in-progress ("generating_skeleton") snapshot with `days: []` before any later
   * poll returns the full `plan`. Used to exercise the `aria-live="polite"`
   * generating-state announcement, which a single instant "ready" response can't
   * reach (plan §5.5, §8 a11y).
   */
  simulateGeneratingDelay?: boolean;
}

export interface StubMealPlanApiResult {
  /** Current in-memory llm settings the stub is serving — read after a save to assert on it. */
  getLlmSettings: () => JsonRecord;
}

/**
 * Registers `page.route` handlers for every meal-plan-related endpoint the web app
 * calls, in the `receipt.spec.ts` `route.fulfill` idiom. Real endpoints (inventory,
 * household, shopping list) are left untouched — they hit the real API server
 * started by `playwright.config.ts`'s webServer, exactly as in every other e2e spec.
 */
export async function stubMealPlanApi(
  page: Page,
  options: StubMealPlanApiOptions = {}
): Promise<StubMealPlanApiResult> {
  const {
    keyConfigured = true,
    initialPlanExists = true,
    plan = FIXTURE_PLAN,
    simulateGeneratingDelay = false,
  } = options;

  let planCreated = initialPlanExists;
  let detailPollCount = 0;

  let llmSettings: JsonRecord = {
    provider: "openai",
    model: "gpt-4o-mini",
    // No household-saved OCR override by default; envDefaults.visionModel below is
    // what receipt OCR actually falls back to.
    visionModel: null,
    keyConfigured,
    keyLast4: keyConfigured ? "7f2c" : null,
    defaultServings: 2,
    allergies: [],
    dietaryRestrictions: [],
    weekStartDay: 1,
    timezone: "America/New_York",
    envDefaults: { provider: "openai", model: "gpt-4o-mini", visionModel: "gpt-4o-mini" },
  };

  // GET/PUT /api/settings/llm — exact match only, never /test (registered separately).
  await page.route("**/api/settings/llm", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await fulfillJson(route, llmSettings);
      return;
    }
    if (method === "PUT") {
      const body = (route.request().postDataJSON() ?? {}) as JsonRecord;
      const apiKey = typeof body.apiKey === "string" ? body.apiKey : null;
      llmSettings = {
        ...llmSettings,
        provider: (body.provider as string | undefined) ?? llmSettings.provider,
        model: (body.model as string | undefined) ?? llmSettings.model,
        // Same omitted/null/string precedent as apiKey (plan §6.2): "visionModel" in
        // body distinguishes "omitted -> no change" from "explicitly null -> clear".
        visionModel:
          "visionModel" in body ? (body.visionModel as string | null) : llmSettings.visionModel,
        defaultServings:
          (body.defaultServings as number | undefined) ?? llmSettings.defaultServings,
        allergies: (body.allergies as string[] | undefined) ?? llmSettings.allergies,
        dietaryRestrictions:
          (body.dietaryRestrictions as string[] | undefined) ?? llmSettings.dietaryRestrictions,
        // Mirrors the real route: apiKey omitted keeps the existing key (plan §6.2).
        keyConfigured: apiKey ? true : llmSettings.keyConfigured,
        keyLast4: apiKey ? apiKey.slice(-4) : llmSettings.keyLast4,
      };
      await fulfillJson(route, llmSettings);
      return;
    }
    await route.continue();
  });

  await page.route("**/api/settings/llm/test", async (route) => {
    await fulfillJson(route, { ok: true, latencyMs: 118 });
  });

  // GET /api/settings/llm/models — live model catalogue (plan §5.6). Stubbed here so
  // UI-only specs (including the AI settings a11y spec) never depend on a real
  // provider key or real outbound network access just to render suggestion chips.
  await page.route("**/api/settings/llm/models*", async (route) => {
    const provider = new URL(route.request().url()).searchParams.get("provider") ?? "openai";
    const modelsByProvider: Record<string, string[]> = {
      openai: ["gpt-5.4-mini", "gpt-4o-mini"],
      anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
      openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.7-sonnet"],
    };
    await fulfillJson(route, { provider, models: modelsByProvider[provider] ?? [], reason: null });
  });

  // Prompt CRUD — kept minimal, just enough for PromptTemplateEditor to seed + save.
  let savedPrompt: JsonRecord | null = null;

  await page.route("**/api/meal-plans/prompts", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await fulfillJson(route, savedPrompt ? [savedPrompt] : []);
      return;
    }
    if (method === "POST") {
      const body = (route.request().postDataJSON() ?? {}) as JsonRecord;
      savedPrompt = {
        id: "fixture-prompt-0001",
        householdId: "fixture-household-0001",
        name: (body.name as string | undefined) ?? "Default",
        body: (body.body as string | undefined) ?? "",
        isDefault: (body.isDefault as boolean | undefined) ?? true,
        updatedBy: "fixture-user-0001",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await fulfillJson(route, savedPrompt, 201);
      return;
    }
    await route.continue();
  });

  await page.route("**/api/meal-plans/prompts/*", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = (route.request().postDataJSON() ?? {}) as JsonRecord;
      savedPrompt = {
        ...(savedPrompt ?? {
          id: "fixture-prompt-0001",
          householdId: "fixture-household-0001",
          name: "Default",
          isDefault: true,
          updatedBy: "fixture-user-0001",
          createdAt: new Date().toISOString(),
        }),
        ...body,
        updatedAt: new Date().toISOString(),
      };
      await fulfillJson(route, savedPrompt);
      return;
    }
    await route.continue();
  });

  // GET (list/discovery) + POST (create) at the bare collection endpoint. A single
  // `*` after "meal-plans" matches an optional query string but never a `/` — so this
  // never shadows `/api/meal-plans/prompts` or `/api/meal-plans/:id` below.
  await page.route("**/api/meal-plans*", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await fulfillJson(route, {
        items: planCreated ? [toSummary(plan)] : [],
        page: 1,
        pageSize: 1,
      });
      return;
    }
    if (method === "POST") {
      planCreated = true;
      detailPollCount = 0;
      await fulfillJson(route, { id: plan.id, status: "generating_skeleton" }, 202);
      return;
    }
    await route.continue();
  });

  // GET /api/meal-plans/:id — the polling endpoint.
  await page.route(`**/api/meal-plans/${plan.id}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (simulateGeneratingDelay && detailPollCount === 0) {
      detailPollCount += 1;
      await fulfillJson(route, {
        ...plan,
        status: "generating_skeleton",
        progressDone: 0,
        progressTotal: plan.days.reduce((sum, d) => sum + d.meals.length, 0),
        days: [],
      });
      return;
    }
    await fulfillJson(route, plan);
  });

  await page.route(`**/api/meal-plans/${plan.id}/shopping/commit`, async (route) => {
    if (route.request().method() === "POST") {
      const body = (route.request().postDataJSON() ?? {}) as { ingredientIds?: string[] };
      await fulfillJson(route, { created: body.ingredientIds?.length ?? 0 });
      return;
    }
    await route.continue();
  });

  await page.route(`**/api/meal-plans/${plan.id}/meals/*/regenerate`, async (route) => {
    if (route.request().method() === "POST") {
      const match = /\/meals\/([^/]+)\/regenerate/.exec(route.request().url());
      await fulfillJson(route, { id: match?.[1] ?? "", detailStatus: "pending" }, 202);
      return;
    }
    await route.continue();
  });

  await page.route(`**/api/meal-plans/${plan.id}/cancel`, async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, { ...toSummary(plan), status: "cancelled" });
      return;
    }
    await route.continue();
  });

  return { getLlmSettings: () => llmSettings };
}

/** A "generation failed" plan snapshot — same id as the fixture so route stubbing
 * needs no extra wiring, `status: "failed"` so `classifyMealPlanError` renders the
 * `role="alert"` banner (`MealPlanPage.tsx`'s `displayError`). See `mealplan.spec.ts`
 * for why this, not a raw HTTP 502, is what actually exercises the banner. */
export function buildFailedPlan(overrides: Partial<FixturePlan> = {}): FixturePlan {
  return {
    ...FIXTURE_PLAN,
    status: "failed",
    progressDone: 0,
    progressTotal: 8,
    errorCode: "provider_unavailable",
    errorMessage:
      "The AI provider is temporarily unavailable or busy. Wait a few minutes and try again.",
    days: [],
    ...overrides,
  };
}
