/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { setupTestDb, teardownTestDb, clearTables, testDb, createTestSession } from "../setup";
import { factories } from "../factories";
import {
  households,
  users,
  householdLlmSettings,
  mealPlans,
  mealPlanDays,
  mealPlanMeals,
  mealPlanIngredients,
  mealPlanPrompts,
  shoppingListItems,
  items,
} from "../../db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import mealPlansRoute from "../../routes/meal-plans";
import { _deps } from "../../lib/llm";
import { encryptSecret } from "../../lib/crypto";
import { PlanSkeletonSchema, RecipeDetailSchema } from "../../lib/mealplan/schema";
import { localDateStringInTimezone, isoWeekdayOfLocalDateString } from "../../lib/mealplan/schedule";

const originalGenerateObject = _deps.generateObject;

afterEach(() => {
  _deps.generateObject = originalGenerateObject;
});

async function makeHousehold() {
  const household = factories.household();
  const session = await createTestSession();
  const user = factories.user(household.id, { id: session.id, displayName: session.name });

  await testDb.insert(households).values(household);
  await testDb.insert(users).values(user);

  return { household, user, session };
}

async function configureLlm(
  householdId: string,
  overrides?: Partial<{ weekStartDay: number; timezone: string }>
) {
  const encrypted = await encryptSecret("sk-test-configured-key", householdId);
  await testDb.insert(householdLlmSettings).values(
    factories.llmSettings(householdId, {
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyIv: encrypted.iv,
      apiKeyTag: encrypted.tag,
      apiKeyLast4: "3key",
      apiKeyFingerprint: "fingerprint",
      kekVersion: encrypted.kekVersion,
      ...overrides,
    })
  );
}

/** Per-call token usage baked into stubHappyPathGeneration's two responses (finding 5). */
const HAPPY_PATH_SKELETON_USAGE = { inputTokens: 500, outputTokens: 300 };
const HAPPY_PATH_RECIPE_USAGE = { inputTokens: 200, outputTokens: 150 };

function stubHappyPathGeneration() {
  _deps.generateObject = mock(async (params: any) => {
    if (params.schema === PlanSkeletonSchema) {
      return {
        object: {
          meals: [
            {
              dayIndex: 0,
              slot: "dinner",
              title: "Sheet-Pan Chicken",
              summary: "Roasted chicken with vegetables.",
              servings: 2,
              keyIngredients: ["chicken thighs", "onion"],
            },
          ],
        },
        usage: HAPPY_PATH_SKELETON_USAGE,
      };
    }
    if (params.schema === RecipeDetailSchema) {
      return {
        object: {
          prepMinutes: 10,
          cookMinutes: 30,
          ingredients: [
            { name: "onion", quantity: 1, unit: "unit", preparation: "diced", optional: false },
            { name: "chicken thighs", quantity: 2, unit: "lb", preparation: null, optional: false },
          ],
          steps: ["Dice the onion.", "Roast everything together."],
        },
        usage: HAPPY_PATH_RECIPE_USAGE,
      };
    }
    throw new Error(`Unexpected schema in test stub`);
  }) as any;
}

async function waitForStatus(
  app: Hono,
  planId: string,
  cookie: string,
  predicate: (status: string) => boolean,
  timeoutMs = 3000
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.request(`/${planId}`, { headers: { Cookie: cookie } });
    const json = await res.json();
    if (predicate(json.data.status)) return json.data;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for plan status; last seen: ${json.data.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// The container-wide env-key fallback (plan §4.5) reads these directly from
// process.env — save/restore around every test so ambient env hygiene never affects
// an assertion that assumes "no key configured", and tests that deliberately exercise
// the fallback don't leak their value into any other test.
const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "LLM_PROVIDER",
  "LLM_MODEL",
] as const;
let savedEnv: Record<string, string | undefined>;

describe("Meal Plans API Routes", () => {
  let app: Hono;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  beforeEach(async () => {
    await clearTables();
    app = new Hono();
    app.route("/", mealPlansRoute);
  });

  describe("POST /", () => {
    it("requires authentication", async () => {
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: "2026-03-02",
          dayCount: 1,
          slots: ["dinner"],
          mode: "balanced",
        }),
      });
      expect(res.status).toBe(401);
    });

    it("400s on invalid body (no slots)", async () => {
      const { session } = await makeHousehold();
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body: JSON.stringify({ startDate: "2026-03-02", dayCount: 1, slots: [], mode: "balanced" }),
      });
      expect(res.status).toBe(400);
    });

    it("400s when no LLM settings are configured", async () => {
      const { session } = await makeHousehold();
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body: JSON.stringify({
          startDate: "2026-03-02",
          dayCount: 1,
          slots: ["dinner"],
          mode: "balanced",
        }),
      });
      expect(res.status).toBe(400);
    });

    // -----------------------------------------------------------------------------
    // Container-wide env-key fallback (plan §4.5): a household with no key of its own
    // (or none configured at all) still generates off a matching process-env key —
    // both for a household that DID pick a provider in Settings and one that never
    // opened Settings at all (provider/model NULL, no row).
    // -----------------------------------------------------------------------------
    it("202s using the container-wide env key when the household saved a provider but no key", async () => {
      const { household, session } = await makeHousehold();
      await testDb.insert(householdLlmSettings).values(factories.llmSettings(household.id));
      stubHappyPathGeneration();

      process.env.OPENAI_API_KEY = "sk-env-fallback-key";
      try {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session.cookie },
          body: JSON.stringify({
            startDate: "2026-03-02",
            dayCount: 1,
            slots: ["dinner"],
            mode: "balanced",
          }),
        });
        expect(res.status).toBe(202);
        const { id } = (await res.json()).data;

        const ready = await waitForStatus(app, id, session.cookie, (s) => s === "ready");
        expect(ready.days).toHaveLength(1);

        const [row] = await testDb.select().from(mealPlans).where(eq(mealPlans.id, id));
        expect(row!.providerSnapshot).toBe("openai");
        expect(row!.modelSnapshot).toBe("gpt-4o-mini");
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it("202s using the pure LLM_PROVIDER/LLM_MODEL + matching key default for a household that has never opened Settings", async () => {
      const { session } = await makeHousehold(); // no household_llm_settings row at all
      stubHappyPathGeneration();

      process.env.LLM_PROVIDER = "anthropic";
      process.env.LLM_MODEL = "claude-haiku-4-5-20251001";
      process.env.ANTHROPIC_API_KEY = "sk-env-default-key";
      try {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session.cookie },
          body: JSON.stringify({
            startDate: "2026-03-02",
            dayCount: 1,
            slots: ["dinner"],
            mode: "balanced",
          }),
        });
        expect(res.status).toBe(202);
        const { id } = (await res.json()).data;

        const [row] = await testDb.select().from(mealPlans).where(eq(mealPlans.id, id));
        expect(row!.providerSnapshot).toBe("anthropic");
        expect(row!.modelSnapshot).toBe("claude-haiku-4-5-20251001");
      } finally {
        delete process.env.LLM_PROVIDER;
        delete process.env.LLM_MODEL;
        delete process.env.ANTHROPIC_API_KEY;
      }
    });

    it("does not cross providers: an anthropic-configured household with only OPENAI_API_KEY set still 400s", async () => {
      const { household, session } = await makeHousehold();
      await testDb.insert(householdLlmSettings).values(
        factories.llmSettings(household.id, {
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
        })
      );

      process.env.OPENAI_API_KEY = "sk-env-wrong-provider";
      try {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session.cookie },
          body: JSON.stringify({
            startDate: "2026-03-02",
            dayCount: 1,
            slots: ["dinner"],
            mode: "balanced",
          }),
        });
        expect(res.status).toBe(400);
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it("202s with {id, status: 'queued'} and eventually reaches 'ready' via background generation", async () => {
      const { household, session } = await makeHousehold();
      await configureLlm(household.id);
      stubHappyPathGeneration();

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body: JSON.stringify({
          startDate: "2026-03-02",
          dayCount: 1,
          slots: ["dinner"],
          mode: "balanced",
        }),
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.status).toBe("queued");
      expect(json.data.id).toBeDefined();

      const ready = await waitForStatus(app, json.data.id, session.cookie, (s) => s === "ready");
      expect(ready.days).toHaveLength(1);
      expect(ready.days[0].meals).toHaveLength(1);
      const meal = ready.days[0].meals[0];
      expect(meal.title).toBe("Sheet-Pan Chicken");
      expect(meal.detailStatus).toBe("ready");
      expect(meal.instructions).toEqual(["Dice the onion.", "Roast everything together."]);
      expect(meal.ingredients.length).toBe(2);
      expect(
        meal.ingredients.every((i: any) => typeof i.quantity === "number" || i.quantity === null)
      ).toBe(true);
    });

    // -----------------------------------------------------------------------------
    // Root-cause regression — reproduced live (plan ed5040c9-ec87-4bcd-bcdc-c77873d1d5ee):
    // `meal_plans_one_per_week_idx` (UNIQUE on household_id, start_date WHERE status =
    // 'ready') allows only one 'ready' plan per household per week. A SECOND
    // generation for a week that already has a 'ready' plan used to complete BOTH
    // meals successfully and then crash on its own final `status: 'ready'` UPDATE with
    // a raw Postgres 23505 — silently swallowed by the old catch-all and mislabeled
    // `provider_unavailable`, even though the skeleton and every meal genuinely
    // succeeded (a contract violation of plan §4.1: "a plan reaches ready when the
    // skeleton succeeded"). The fix demotes the older 'ready' sibling atomically in the
    // same transaction as the new plan's ready flip.
    // -----------------------------------------------------------------------------
    it("still reaches 'ready' when a plan already exists for the same household+week (finding: one_per_week collision)", async () => {
      const { household, user, session } = await makeHousehold();
      await configureLlm(household.id);

      const sameStartDate = "2026-03-02";
      const [existingReady] = await testDb
        .insert(mealPlans)
        .values(
          factories.mealPlan(household.id, user.id, {
            startDate: sameStartDate,
            mode: "expiring_first",
            status: "ready",
          })
        )
        .returning();

      stubHappyPathGeneration();

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body: JSON.stringify({
          startDate: sameStartDate,
          dayCount: 2,
          slots: ["dinner"],
          mode: "balanced",
        }),
      });
      expect(res.status).toBe(202);
      const { id } = (await res.json()).data;

      // Must reach 'ready', not 'failed' — both meals succeed, so the plan must too.
      const ready = await waitForStatus(app, id, session.cookie, (s) => s === "ready");
      expect(ready.status).toBe("ready");
      expect(ready.errorCode).toBeNull();
      // Balanced mode has no priority set at all — always null, never a NaN/0 artifact
      // of an empty priority set (documented on GenerationOutcome.priorityCoverage).
      expect(ready.priorityCoverage).toBeNull();
      expect(ready.days.flatMap((d: any) => d.meals).every((m: any) => m.detailStatus === "ready")).toBe(
        true
      );

      // The older sibling is demoted out of 'ready' (so the unique index never trips)
      // but its row — and data — remain fully intact and queryable (plan §4.5
      // "Regeneration": never mutates in place, old plan stays queryable).
      const [demoted] = await testDb
        .select()
        .from(mealPlans)
        .where(eq(mealPlans.id, existingReady!.id));
      expect(demoted!.status).not.toBe("ready");
      expect(demoted!.startDate).toBe(sameStartDate);
      expect(demoted!.mode).toBe("expiring_first");

      const getOld = await app.request(`/${existingReady!.id}`, {
        headers: { Cookie: session.cookie },
      });
      expect(getOld.status).toBe(200);
    });

    it("409s on a second concurrent POST, leaving exactly one row in the DB", async () => {
      const { household, session } = await makeHousehold();
      await configureLlm(household.id);
      // Never resolves — keeps the first plan "generating" for the duration of this test.
      _deps.generateObject = mock(() => new Promise(() => {})) as any;

      const body = JSON.stringify({
        startDate: "2026-03-02",
        dayCount: 1,
        slots: ["dinner"],
        mode: "balanced",
      });

      const [res1, res2] = await Promise.all([
        app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session.cookie },
          body,
        }),
        app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session.cookie },
          body,
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([202, 409]);

      const rows = await testDb
        .select()
        .from(mealPlans)
        .where(eq(mealPlans.householdId, household.id));
      expect(rows.length).toBe(1);
    });

    // -----------------------------------------------------------------------------
    // Bug fix — `week_start_day`/`timezone` were fully migrated and exposed through
    // Settings but had zero consumers: every plan defaulted to "today" regardless.
    // `startDate` is now optional; omitting it defaults to the household's configured
    // week start. Exhaustive `now`-pinned coverage of the day-selection logic itself
    // (never-in-the-past, DST boundaries) lives in schedule.test.ts — this only proves
    // the route actually wires the setting through.
    // -----------------------------------------------------------------------------
    it("defaults startDate to the household's configured week start when omitted", async () => {
      const { household, session } = await makeHousehold();
      await configureLlm(household.id, { weekStartDay: 1, timezone: "America/New_York" });
      stubHappyPathGeneration();

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body: JSON.stringify({ dayCount: 1, slots: ["dinner"], mode: "balanced" }), // no startDate
      });
      expect(res.status).toBe(202);
      const { id } = (await res.json()).data;

      const [row] = await testDb.select().from(mealPlans).where(eq(mealPlans.id, id));
      const today = localDateStringInTimezone(new Date(), "America/New_York");
      expect(row!.startDate >= today).toBe(true);
      expect(isoWeekdayOfLocalDateString(row!.startDate)).toBe(1); // Monday
    });

    it("uses the explicit startDate when the request provides one, ignoring week_start_day", async () => {
      const { household, session } = await makeHousehold();
      await configureLlm(household.id, { weekStartDay: 1, timezone: "America/New_York" });
      stubHappyPathGeneration();

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body: JSON.stringify({
          startDate: "2026-03-04", // a Wednesday — deliberately NOT the configured Monday
          dayCount: 1,
          slots: ["dinner"],
          mode: "balanced",
        }),
      });
      expect(res.status).toBe(202);
      const { id } = (await res.json()).data;

      const [row] = await testDb.select().from(mealPlans).where(eq(mealPlans.id, id));
      expect(row!.startDate).toBe("2026-03-04");
    });

    // -----------------------------------------------------------------------------
    // Finding 5 — token accounting was dead code: generate.ts never read
    // result.usage and monthly_token_cap was never enforced.
    // -----------------------------------------------------------------------------
    it("persists accumulated phase-1 + phase-2 token usage on the plan row (finding 5)", async () => {
      const { household, session } = await makeHousehold();
      await configureLlm(household.id);
      stubHappyPathGeneration();

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body: JSON.stringify({
          startDate: "2026-03-02",
          dayCount: 1,
          slots: ["dinner"],
          mode: "balanced",
        }),
      });
      expect(res.status).toBe(202);
      const { id } = (await res.json()).data;

      const ready = await waitForStatus(app, id, session.cookie, (s) => s === "ready");
      expect(ready.inputTokens).toBe(
        HAPPY_PATH_SKELETON_USAGE.inputTokens + HAPPY_PATH_RECIPE_USAGE.inputTokens
      );
      expect(ready.outputTokens).toBe(
        HAPPY_PATH_SKELETON_USAGE.outputTokens + HAPPY_PATH_RECIPE_USAGE.outputTokens
      );
    });

    it("429s with monthly_token_cap_exceeded when this month's usage already meets the cap (finding 5)", async () => {
      const { household, user, session } = await makeHousehold();
      await testDb.insert(householdLlmSettings).values({
        ...factories.llmSettings(household.id, {
          apiKeyCiphertext: "irrelevant-ciphertext",
          apiKeyIv: "irrelevant-iv",
          apiKeyTag: "irrelevant-tag",
        }),
        monthlyTokenCap: 100,
      });
      // A prior plan created this month already used exactly the cap (60 + 40 = 100).
      await testDb.insert(mealPlans).values({
        ...factories.mealPlan(household.id, user.id, { status: "ready" }),
        inputTokens: 60,
        outputTokens: 40,
      });

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body: JSON.stringify({
          startDate: "2026-03-09",
          dayCount: 1,
          slots: ["dinner"],
          mode: "balanced",
        }),
      });
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.code).toBe("monthly_token_cap_exceeded");

      // No new row was inserted — the cap is a pre-flight check, not a post-hoc cleanup.
      const rows = await testDb
        .select()
        .from(mealPlans)
        .where(eq(mealPlans.householdId, household.id));
      expect(rows.length).toBe(1);
    });

    it("does not block generation when monthly_token_cap is null (uncapped, the default)", async () => {
      const { household, user, session } = await makeHousehold();
      await configureLlm(household.id);
      stubHappyPathGeneration();
      // A prior plan used a huge number of tokens, but no cap is set.
      await testDb.insert(mealPlans).values({
        ...factories.mealPlan(household.id, user.id, { status: "ready" }),
        inputTokens: 999_999,
        outputTokens: 999_999,
      });

      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body: JSON.stringify({
          startDate: "2026-03-09",
          dayCount: 1,
          slots: ["dinner"],
          mode: "balanced",
        }),
      });
      expect(res.status).toBe(202);
    });

    // -----------------------------------------------------------------------------
    // Finding 3 — the household generation budget (5/hour) is now Postgres-backed
    // (lib/generationLimits.ts) instead of the process-local in-memory Map, and pairs
    // an hourly cap with a 30/day cap (plan §6.5).
    // -----------------------------------------------------------------------------
    it("429s once the hourly generation budget (5) is exhausted for the household (finding 3)", async () => {
      const { household, session } = await makeHousehold();
      await configureLlm(household.id);
      // Never resolves — the background job hangs forever inside phase 1, so no rows
      // beyond the initial insert are ever written; we only care about the rate-limit
      // response here.
      _deps.generateObject = mock(() => new Promise(() => {})) as any;

      const body = JSON.stringify({
        startDate: "2026-03-02",
        dayCount: 1,
        slots: ["dinner"],
        mode: "balanced",
      });

      // Delete each plan row right after the response so the one_active partial unique
      // index (409) never masks the rate-limit response this test targets — the
      // never-resolving stub means nothing else ever writes to this row.
      for (let i = 0; i < 5; i++) {
        const res = await app.request("/", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session.cookie },
          body,
        });
        expect(res.status).toBe(202);
        const { id } = (await res.json()).data;
        await testDb.delete(mealPlans).where(eq(mealPlans.id, id));
      }

      const res6 = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.cookie },
        body,
      });
      expect(res6.status).toBe(429);
      const json6 = await res6.json();
      expect(json6.code).toBe("generation_rate_limited");
    });
  });

  describe("GET /", () => {
    it("returns household-scoped summaries only (IDOR)", async () => {
      const a = await makeHousehold();
      const b = await makeHousehold();
      await testDb.insert(mealPlans).values(factories.mealPlan(a.household.id, a.user.id));
      await testDb.insert(mealPlans).values(factories.mealPlan(b.household.id, b.user.id));

      const res = await app.request("/", { headers: { Cookie: a.session.cookie } });
      const json = await res.json();
      expect(json.data.items.length).toBe(1);
      expect(json.data.items[0].householdId).toBe(a.household.id);
    });
  });

  describe("GET /:id", () => {
    it("cross-household access returns 404, not 403", async () => {
      const a = await makeHousehold();
      const b = await makeHousehold();
      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(a.household.id, a.user.id))
        .returning();

      const res = await app.request(`/${plan!.id}`, { headers: { Cookie: b.session.cookie } });
      expect(res.status).toBe(404);
    });

    it("404s for a non-existent id", async () => {
      const a = await makeHousehold();
      const res = await app.request(`/00000000-0000-0000-0000-000000000000`, {
        headers: { Cookie: a.session.cookie },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /:id/cancel", () => {
    it("sets status to cancelled", async () => {
      const a = await makeHousehold();
      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(a.household.id, a.user.id, { status: "generating_recipes" }))
        .returning();

      const res = await app.request(`/${plan!.id}/cancel`, {
        method: "POST",
        headers: { Cookie: a.session.cookie },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.status).toBe("cancelled");
    });

    it("cross-household cancel returns 404", async () => {
      const a = await makeHousehold();
      const b = await makeHousehold();
      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(a.household.id, a.user.id))
        .returning();

      const res = await app.request(`/${plan!.id}/cancel`, {
        method: "POST",
        headers: { Cookie: b.session.cookie },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /:id/ingredients/:ingId", () => {
    async function seedIngredient(householdId: string, requestedBy: string) {
      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(householdId, requestedBy))
        .returning();
      const [day] = await testDb
        .insert(mealPlanDays)
        .values(factories.mealPlanDay(householdId, plan!.id))
        .returning();
      const [meal] = await testDb
        .insert(mealPlanMeals)
        .values(factories.mealPlanMeal(householdId, plan!.id, day!.id))
        .returning();
      const [ingredient] = await testDb
        .insert(mealPlanIngredients)
        .values(factories.mealPlanIngredient(householdId, meal!.id))
        .returning();
      return { plan: plan!, day: day!, meal: meal!, ingredient: ingredient! };
    }

    it("flips source and sets sourceOverridden", async () => {
      const a = await makeHousehold();
      const { plan, ingredient } = await seedIngredient(a.household.id, a.user.id);

      const res = await app.request(`/${plan.id}/ingredients/${ingredient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({ source: "pantry" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.source).toBe("pantry");
      expect(json.data.sourceOverridden).toBe(true);
    });

    it("cannot PATCH an ingredient belonging to another household's plan (404)", async () => {
      const a = await makeHousehold();
      const b = await makeHousehold();
      const { plan, ingredient } = await seedIngredient(a.household.id, a.user.id);

      const res = await app.request(`/${plan.id}/ingredients/${ingredient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: b.session.cookie },
        body: JSON.stringify({ source: "pantry" }),
      });
      expect(res.status).toBe(404);

      // Verify it truly was not mutated.
      const [unchanged] = await testDb
        .select()
        .from(mealPlanIngredients)
        .where(eq(mealPlanIngredients.id, ingredient.id));
      expect(unchanged!.source).toBe("purchase");
      expect(unchanged!.sourceOverridden).toBe(false);
    });
  });

  describe("GET /:id/shopping and POST /:id/shopping/commit", () => {
    async function seedPlanWithPurchaseIngredients(householdId: string, requestedBy: string) {
      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(householdId, requestedBy))
        .returning();
      const [day] = await testDb
        .insert(mealPlanDays)
        .values(factories.mealPlanDay(householdId, plan!.id))
        .returning();
      const [mealA] = await testDb
        .insert(mealPlanMeals)
        .values(factories.mealPlanMeal(householdId, plan!.id, day!.id, { title: "Meal A" }))
        .returning();
      const [mealB] = await testDb
        .insert(mealPlanMeals)
        .values(
          factories.mealPlanMeal(householdId, plan!.id, day!.id, {
            title: "Meal B",
            slot: "lunch",
            sortOrder: 1,
          })
        )
        .returning();

      // Same normalized ingredient ("onion") used by two different meals — must
      // aggregate into ONE shopping list row, not two (plan §3, §4.4).
      await testDb.insert(mealPlanIngredients).values([
        factories.mealPlanIngredient(householdId, mealA!.id, {
          nameNormalized: "onion",
          rawText: "1 unit onion",
        }),
        factories.mealPlanIngredient(householdId, mealB!.id, {
          nameNormalized: "onion",
          rawText: "2 unit onion",
        }),
      ]);

      return { plan: plan! };
    }

    it("GET /:id/shopping dedupes across meals by nameNormalized", async () => {
      const a = await makeHousehold();
      const { plan } = await seedPlanWithPurchaseIngredients(a.household.id, a.user.id);

      const res = await app.request(`/${plan.id}/shopping`, {
        headers: { Cookie: a.session.cookie },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.items.length).toBe(1);
      expect(json.data.items[0].nameNormalized).toBe("onion");
      expect(json.data.items[0].ingredientIds.length).toBe(2);
      expect(json.data.items[0].alreadyCommitted).toBe(false);
    });

    it("commit creates one shopping_list_items row with origin='meal_plan', and re-tapping never double-adds", async () => {
      const a = await makeHousehold();
      const { plan } = await seedPlanWithPurchaseIngredients(a.household.id, a.user.id);

      const res1 = await app.request(`/${plan.id}/shopping/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({}),
      });
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.data.created).toBe(1);

      const rows = await testDb
        .select()
        .from(shoppingListItems)
        .where(eq(shoppingListItems.householdId, a.household.id));
      expect(rows.length).toBe(1);
      expect(rows[0]!.origin).toBe("meal_plan");
      expect(rows[0]!.name).toBe("onion");

      // Re-tapping commit must not create a second row.
      const res2 = await app.request(`/${plan.id}/shopping/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({}),
      });
      const json2 = await res2.json();
      expect(json2.data.created).toBe(0);

      const rowsAfter = await testDb
        .select()
        .from(shoppingListItems)
        .where(eq(shoppingListItems.householdId, a.household.id));
      expect(rowsAfter.length).toBe(1);
    });

    it("dedupes against an existing pending shopping_list_items row with the same normalized name", async () => {
      const a = await makeHousehold();
      const { plan } = await seedPlanWithPurchaseIngredients(a.household.id, a.user.id);

      await testDb.insert(shoppingListItems).values({
        householdId: a.household.id,
        name: "Onion",
        status: "pending",
        addedBy: a.user.id,
        suggestedQty: "1",
      });

      const res = await app.request(`/${plan.id}/shopping/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      expect(json.data.created).toBe(0); // linked to the existing row, not duplicated

      const rows = await testDb
        .select()
        .from(shoppingListItems)
        .where(eq(shoppingListItems.householdId, a.household.id));
      expect(rows.length).toBe(1);
    });

    // ---------------------------------------------------------------------------
    // Bug fix — commit previously trusted the FROZEN `source` column, written once
    // at generation time and never re-evaluated. Eligibility is now re-derived from
    // LIVE inventory (reconcile.ts's matcher) on every commit call.
    // ---------------------------------------------------------------------------
    async function seedSingleIngredientPlan(
      householdId: string,
      requestedBy: string,
      overrides: Partial<Parameters<typeof factories.mealPlanIngredient>[2]>
    ) {
      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(householdId, requestedBy))
        .returning();
      const [day] = await testDb
        .insert(mealPlanDays)
        .values(factories.mealPlanDay(householdId, plan!.id))
        .returning();
      const [meal] = await testDb
        .insert(mealPlanMeals)
        .values(factories.mealPlanMeal(householdId, plan!.id, day!.id))
        .returning();
      const [ingredient] = await testDb
        .insert(mealPlanIngredients)
        .values(factories.mealPlanIngredient(householdId, meal!.id, overrides))
        .returning();
      return { plan: plan!, ingredient: ingredient! };
    }

    it("an ingredient persisted 'pantry' whose matched item is now depleted (quantity 0) IS committed", async () => {
      const a = await makeHousehold();
      const [pantryItem] = await testDb
        .insert(items)
        .values(factories.item(a.household.id, a.user.id, { name: "Onion", quantity: "0" }))
        .returning();
      const { plan } = await seedSingleIngredientPlan(a.household.id, a.user.id, {
        nameNormalized: "onion",
        source: "pantry",
        matchedItemId: pantryItem!.id,
      });

      const res = await app.request(`/${plan.id}/shopping/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.created).toBe(1);
      expect(json.data.skipped).toBe(0);
    });

    it("an ingredient persisted 'pantry' whose matched item has since been deleted IS committed", async () => {
      const a = await makeHousehold();
      // No `items` row at all for this household — the pantry match no longer exists.
      const { plan } = await seedSingleIngredientPlan(a.household.id, a.user.id, {
        nameNormalized: "onion",
        source: "pantry",
        matchedItemId: null,
      });

      const res = await app.request(`/${plan.id}/shopping/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      expect(json.data.created).toBe(1);
    });

    it("a staple ingredient is never committed, even though it is not in inventory", async () => {
      const a = await makeHousehold();
      const { plan } = await seedSingleIngredientPlan(a.household.id, a.user.id, {
        nameNormalized: "salt",
        source: "purchase", // even if the persisted column says purchase
      });

      const res = await app.request(`/${plan.id}/shopping/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      expect(json.data.created).toBe(0);
      expect(json.data.skipped).toBe(1);

      const rows = await testDb
        .select()
        .from(shoppingListItems)
        .where(eq(shoppingListItems.householdId, a.household.id));
      expect(rows.length).toBe(0);
    });

    it("an explicit source_overridden to 'pantry' is NOT committed even if inventory is empty", async () => {
      const a = await makeHousehold();
      // No items at all — a live re-derivation with no override would classify this as
      // "purchase". The override must still win.
      const { plan } = await seedSingleIngredientPlan(a.household.id, a.user.id, {
        nameNormalized: "onion",
        source: "pantry",
        sourceOverridden: true,
      });

      const res = await app.request(`/${plan.id}/shopping/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      expect(json.data.created).toBe(0);
      expect(json.data.skipped).toBe(1);
    });

    it("an explicit source_overridden to 'purchase' IS committed, and re-committing does not duplicate", async () => {
      const a = await makeHousehold();
      const [pantryItem] = await testDb
        .insert(items)
        .values(factories.item(a.household.id, a.user.id, { name: "Onion", quantity: "5" }))
        .returning();
      // Live re-derivation (no override) would say "pantry" (still in stock) — the
      // user's explicit override to "purchase" must still win.
      const { plan } = await seedSingleIngredientPlan(a.household.id, a.user.id, {
        nameNormalized: "onion",
        source: "purchase",
        sourceOverridden: true,
        matchedItemId: pantryItem!.id,
      });

      const res1 = await app.request(`/${plan.id}/shopping/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({}),
      });
      expect((await res1.json()).data.created).toBe(1);

      const res2 = await app.request(`/${plan.id}/shopping/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({}),
      });
      expect((await res2.json()).data.created).toBe(0);

      const rows = await testDb
        .select()
        .from(shoppingListItems)
        .where(eq(shoppingListItems.householdId, a.household.id));
      expect(rows.length).toBe(1);
    });
  });

  describe("DELETE /:id", () => {
    it("deletes a plan owned by the household", async () => {
      const a = await makeHousehold();
      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(a.household.id, a.user.id))
        .returning();

      const res = await app.request(`/${plan!.id}`, {
        method: "DELETE",
        headers: { Cookie: a.session.cookie },
      });
      expect(res.status).toBe(200);

      const rows = await testDb.select().from(mealPlans).where(eq(mealPlans.id, plan!.id));
      expect(rows.length).toBe(0);
    });

    it("cross-household delete returns 404 and leaves the row intact", async () => {
      const a = await makeHousehold();
      const b = await makeHousehold();
      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(a.household.id, a.user.id))
        .returning();

      const res = await app.request(`/${plan!.id}`, {
        method: "DELETE",
        headers: { Cookie: b.session.cookie },
      });
      expect(res.status).toBe(404);

      const rows = await testDb.select().from(mealPlans).where(eq(mealPlans.id, plan!.id));
      expect(rows.length).toBe(1);
    });
  });

  describe("POST /:id/meals/:mealId/regenerate", () => {
    async function seedMeal(householdId: string, requestedBy: string) {
      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(householdId, requestedBy))
        .returning();
      const [day] = await testDb
        .insert(mealPlanDays)
        .values(factories.mealPlanDay(householdId, plan!.id))
        .returning();
      const [meal] = await testDb
        .insert(mealPlanMeals)
        .values(factories.mealPlanMeal(householdId, plan!.id, day!.id))
        .returning();
      return { plan: plan!, meal: meal! };
    }

    it("202s and sets detailStatus back to pending", async () => {
      const a = await makeHousehold();
      await configureLlm(a.household.id);
      _deps.generateObject = mock(async () => ({
        object: {
          prepMinutes: 5,
          cookMinutes: 5,
          ingredients: [],
          steps: ["Step one.", "Step two."],
        },
      })) as any;
      const { plan, meal } = await seedMeal(a.household.id, a.user.id);

      const res = await app.request(`/${plan.id}/meals/${meal.id}/regenerate`, {
        method: "POST",
        headers: { Cookie: a.session.cookie },
      });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.data.detailStatus).toBe("pending");
    });

    it("cross-household regenerate returns 404", async () => {
      const a = await makeHousehold();
      const b = await makeHousehold();
      const { plan, meal } = await seedMeal(a.household.id, a.user.id);

      const res = await app.request(`/${plan.id}/meals/${meal.id}/regenerate`, {
        method: "POST",
        headers: { Cookie: b.session.cookie },
      });
      expect(res.status).toBe(404);
    });

    // -----------------------------------------------------------------------------
    // Finding 2 — regenerate had NO rate limit at all, letting a per-meal regenerate
    // loop bypass the "5 generations/household/hour" cost control entirely. Fixed by
    // sharing the same Postgres-backed household budget as full-plan generation
    // (finding 3, lib/generationLimits.ts) — both draw from the same billed budget.
    // -----------------------------------------------------------------------------
    it("shares the household's generation budget: the 6th regenerate in the same hour is 429 (finding 2)", async () => {
      const a = await makeHousehold();
      await configureLlm(a.household.id);
      _deps.generateObject = mock(async () => ({
        object: { prepMinutes: 5, cookMinutes: 5, ingredients: [], steps: ["Step one.", "Step two."] },
      })) as any;
      const { plan, meal } = await seedMeal(a.household.id, a.user.id);

      for (let i = 0; i < 5; i++) {
        const res = await app.request(`/${plan.id}/meals/${meal.id}/regenerate`, {
          method: "POST",
          headers: { Cookie: a.session.cookie },
        });
        expect(res.status).toBe(202);
      }

      const res6 = await app.request(`/${plan.id}/meals/${meal.id}/regenerate`, {
        method: "POST",
        headers: { Cookie: a.session.cookie },
      });
      expect(res6.status).toBe(429);
      const json6 = await res6.json();
      expect(json6.code).toBe("generation_rate_limited");

      // The meal must NOT have been left stuck in "pending" by the rejected 6th call —
      // the rate limit is checked before detailStatus is ever flipped.
      const [mealRow] = await testDb
        .select()
        .from(mealPlanMeals)
        .where(eq(mealPlanMeals.id, meal.id));
      expect(mealRow!.detailStatus).not.toBe("pending");
    });

    it("a cross-household regenerate attempt (404) never consumes the OWNER household's rate-limit budget", async () => {
      const a = await makeHousehold();
      const b = await makeHousehold();
      const { plan, meal } = await seedMeal(a.household.id, a.user.id);

      // Five probes from household b against household a's meal — all 404, none of
      // them should touch household a's budget.
      for (let i = 0; i < 5; i++) {
        const res = await app.request(`/${plan.id}/meals/${meal.id}/regenerate`, {
          method: "POST",
          headers: { Cookie: b.session.cookie },
        });
        expect(res.status).toBe(404);
      }

      await configureLlm(a.household.id);
      _deps.generateObject = mock(async () => ({
        object: { prepMinutes: 5, cookMinutes: 5, ingredients: [], steps: ["s1", "s2"] },
      })) as any;

      const ownerRes = await app.request(`/${plan.id}/meals/${meal.id}/regenerate`, {
        method: "POST",
        headers: { Cookie: a.session.cookie },
      });
      expect(ownerRes.status).toBe(202);
    });

    it("accumulates additional token usage onto the plan's existing totals (finding 5)", async () => {
      const a = await makeHousehold();
      await configureLlm(a.household.id);
      _deps.generateObject = mock(async () => ({
        object: { prepMinutes: 5, cookMinutes: 5, ingredients: [], steps: ["s1", "s2"] },
        usage: { inputTokens: 40, outputTokens: 60 },
      })) as any;
      const { plan, meal } = await seedMeal(a.household.id, a.user.id);
      await testDb
        .update(mealPlans)
        .set({ inputTokens: 10, outputTokens: 20 })
        .where(eq(mealPlans.id, plan.id));

      const res = await app.request(`/${plan.id}/meals/${meal.id}/regenerate`, {
        method: "POST",
        headers: { Cookie: a.session.cookie },
      });
      expect(res.status).toBe(202);

      // regenerateMeal runs fire-and-forget; poll until its DB write lands.
      const deadline = Date.now() + 3000;
      let row: typeof mealPlans.$inferSelect | undefined;
      for (;;) {
        [row] = await testDb.select().from(mealPlans).where(eq(mealPlans.id, plan.id));
        if (row!.inputTokens === 50) break;
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for token accumulation; last seen: ${row!.inputTokens}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(row!.inputTokens).toBe(50);
      expect(row!.outputTokens).toBe(80);
    });
  });

  describe("Prompts CRUD", () => {
    it("creates, lists, updates, and deletes a prompt", async () => {
      const a = await makeHousehold();

      const createRes = await app.request("/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({ name: "Weeknight", body: "Keep it simple. {{PANTRY}}" }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()).data;

      const listRes = await app.request("/prompts", { headers: { Cookie: a.session.cookie } });
      const list = (await listRes.json()).data;
      expect(list.length).toBe(1);

      const patchRes = await app.request(`/prompts/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({ name: "Weeknight (updated)" }),
      });
      expect(patchRes.status).toBe(200);
      expect((await patchRes.json()).data.name).toBe("Weeknight (updated)");

      const deleteRes = await app.request(`/prompts/${created.id}`, {
        method: "DELETE",
        headers: { Cookie: a.session.cookie },
      });
      expect(deleteRes.status).toBe(200);
    });

    it("only one prompt can be is_default per household — creating a second default unsets the first", async () => {
      const a = await makeHousehold();

      const res1 = await app.request("/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({ name: "First", body: "First body {{PANTRY}}", isDefault: true }),
      });
      const first = (await res1.json()).data;

      const res2 = await app.request("/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: a.session.cookie },
        body: JSON.stringify({ name: "Second", body: "Second body {{PANTRY}}", isDefault: true }),
      });
      expect(res2.status).toBe(201);

      const rows = await testDb
        .select()
        .from(mealPlanPrompts)
        .where(eq(mealPlanPrompts.householdId, a.household.id));
      const firstRow = rows.find((r) => r.id === first.id);
      const secondRow = rows.find((r) => r.id !== first.id);
      expect(firstRow!.isDefault).toBe(false);
      expect(secondRow!.isDefault).toBe(true);
    });

    it("cross-household PATCH/DELETE on a prompt returns 404", async () => {
      const a = await makeHousehold();
      const b = await makeHousehold();
      const [prompt] = await testDb
        .insert(mealPlanPrompts)
        .values(factories.mealPlanPrompt(a.household.id))
        .returning();

      const patchRes = await app.request(`/prompts/${prompt!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: b.session.cookie },
        body: JSON.stringify({ name: "Hijacked" }),
      });
      expect(patchRes.status).toBe(404);

      const deleteRes = await app.request(`/prompts/${prompt!.id}`, {
        method: "DELETE",
        headers: { Cookie: b.session.cookie },
      });
      expect(deleteRes.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------------
  // IDOR matrix: every endpoint x method, cross-household access is 404, never 403
  // (plan §6.6 — don't confirm existence).
  // -------------------------------------------------------------------------------
  describe("household-isolation matrix", () => {
    it("every plan-scoped endpoint returns 404 (not 403) for a cross-household caller", async () => {
      const a = await makeHousehold();
      const b = await makeHousehold();

      const [plan] = await testDb
        .insert(mealPlans)
        .values(factories.mealPlan(a.household.id, a.user.id))
        .returning();
      const [day] = await testDb
        .insert(mealPlanDays)
        .values(factories.mealPlanDay(a.household.id, plan!.id))
        .returning();
      const [meal] = await testDb
        .insert(mealPlanMeals)
        .values(factories.mealPlanMeal(a.household.id, plan!.id, day!.id))
        .returning();
      const [ingredient] = await testDb
        .insert(mealPlanIngredients)
        .values(factories.mealPlanIngredient(a.household.id, meal!.id))
        .returning();

      const cases: { method: string; path: string; body?: unknown }[] = [
        { method: "GET", path: `/${plan!.id}` },
        { method: "POST", path: `/${plan!.id}/cancel` },
        { method: "POST", path: `/${plan!.id}/meals/${meal!.id}/regenerate` },
        {
          method: "PATCH",
          path: `/${plan!.id}/ingredients/${ingredient!.id}`,
          body: { source: "pantry" },
        },
        { method: "GET", path: `/${plan!.id}/shopping` },
        { method: "POST", path: `/${plan!.id}/shopping/commit`, body: {} },
        { method: "DELETE", path: `/${plan!.id}` },
      ];

      for (const testCase of cases) {
        const res = await app.request(testCase.path, {
          method: testCase.method,
          headers: {
            Cookie: b.session.cookie,
            ...(testCase.body ? { "Content-Type": "application/json" } : {}),
          },
          body: testCase.body ? JSON.stringify(testCase.body) : undefined,
        });
        expect(res.status).toBe(404);
      }
    });
  });
});
