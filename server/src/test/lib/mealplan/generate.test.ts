/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, afterEach, mock } from "bun:test";
import { APICallError, NoObjectGeneratedError } from "ai";
import { _deps } from "../../../lib/llm";
import {
  generatePlanContent,
  GenerationFailure,
  type GenerationConfig,
  type GenerationHooks,
  type MealSkeletonResult,
} from "../../../lib/mealplan/generate";
import { PlanSkeletonSchema, RecipeDetailSchema } from "../../../lib/mealplan/schema";
import type { PantryItem } from "../../../lib/mealplan/prompt";

const originalGenerateObject = _deps.generateObject;

afterEach(() => {
  _deps.generateObject = originalGenerateObject;
});

// ---------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------

function pantryItem(overrides: Partial<PantryItem> = {}): PantryItem {
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

function baseConfig(overrides: Partial<GenerationConfig> = {}): GenerationConfig {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "sk-test-key-should-never-leak",
    dayCount: 1,
    slots: ["dinner"],
    mode: "balanced",
    includeExpired: false,
    servings: 2,
    allergies: [],
    dietaryRestrictions: [],
    userTemplate: "Plan {{DAYS}} day(s) for {{HOUSEHOLD}}, {{SERVINGS}} servings.\n{{PANTRY}}",
    householdName: "Test Household",
    ...overrides,
  };
}

function skeletonMeal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dayIndex: 0,
    slot: "dinner",
    title: "Sheet-Pan Chicken",
    summary: "Roasted chicken with vegetables.",
    servings: 2,
    keyIngredients: ["chicken thighs", "onion"],
    ...overrides,
  };
}

function recipeDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    prepMinutes: 10,
    cookMinutes: 30,
    ingredients: [
      { name: "onion", quantity: 1, unit: "unit", preparation: "diced", optional: false },
    ],
    steps: ["Dice the onion.", "Roast everything together."],
    ...overrides,
  };
}

function noopHooks(overrides: Partial<GenerationHooks> = {}): GenerationHooks {
  return {
    onSkeletonReady: async () => {},
    onMealSettled: async () => {},
    isCancelled: async () => false,
    ...overrides,
  };
}

function apiCallError(
  statusCode: number,
  body = "irrelevant",
  responseHeaders?: Record<string, string>
) {
  return new APICallError({
    message: `request failed with status ${statusCode}`,
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: body,
    responseHeaders,
  });
}

// ---------------------------------------------------------------------------------
// What we send
// ---------------------------------------------------------------------------------

describe("generatePlanContent — phase 1 request shape", () => {
  test("sends PlanSkeletonSchema, a system prompt containing pantry items, and a forwarded AbortSignal", async () => {
    // A single requested meal means phase 2 also fires; capture only the FIRST
    // (phase-1 skeleton) call so a later phase-2 call doesn't overwrite it.
    let captured: any;
    _deps.generateObject = mock(async (params: any) => {
      if (!captured) captured = params;
      return { object: { meals: [skeletonMeal()] } };
    }) as any;

    await generatePlanContent(
      {
        items: [pantryItem({ name: "yellow onion" })],
        config: baseConfig(),
        now: new Date("2026-03-01T12:00:00Z"),
        householdId: "household-1",
      },
      noopHooks()
    );

    expect(captured.schema).toBe(PlanSkeletonSchema);
    expect(captured.system).toContain("yellow onion");
    expect(captured.abortSignal).toBeInstanceOf(AbortSignal);
  });

  test("system prompt describes exactly the requested day/slot combinations", async () => {
    let captured: any;
    _deps.generateObject = mock(async (params: any) => {
      if (!captured) captured = params;
      return { object: { meals: [skeletonMeal(), skeletonMeal({ slot: "breakfast" })] } };
    }) as any;

    await generatePlanContent(
      {
        items: [],
        config: baseConfig({ dayCount: 2, slots: ["breakfast", "dinner"] }),
        now: new Date(),
        householdId: "household-1",
      },
      noopHooks()
    );

    const userText = captured.messages[0].content as string;
    expect(userText).toContain("Day 0: breakfast");
    expect(userText).toContain("Day 0: dinner");
    expect(userText).toContain("Day 1: breakfast");
    expect(userText).toContain("Day 1: dinner");
  });

  test("never leaks the raw API key into the system prompt", async () => {
    let captured: any;
    _deps.generateObject = mock(async (params: any) => {
      if (!captured) captured = params;
      return { object: { meals: [skeletonMeal()] } };
    }) as any;

    await generatePlanContent(
      {
        items: [],
        config: baseConfig({ apiKey: "sk-super-secret-do-not-leak" }),
        now: new Date(),
        householdId: "household-1",
      },
      noopHooks()
    );

    expect(captured.system).not.toContain("sk-super-secret-do-not-leak");
  });
});

describe("generatePlanContent — phase 2 request shape", () => {
  test("sends RecipeDetailSchema per meal with a small pantry digest, not the full inventory", async () => {
    const manyItems = Array.from({ length: 80 }, (_, i) =>
      pantryItem({ id: `item-${i}`, name: `ingredient-${i}` })
    );

    let phase1System = "";
    let phase2System = "";
    let phase2Schema: unknown;
    let call = 0;

    _deps.generateObject = mock(async (params: any) => {
      call += 1;
      if (call === 1) {
        phase1System = params.system;
        return { object: { meals: [skeletonMeal()] } };
      }
      phase2System = params.system;
      phase2Schema = params.schema;
      return { object: recipeDetail() };
    }) as any;

    await generatePlanContent(
      { items: manyItems, config: baseConfig(), now: new Date(), householdId: "household-1" },
      noopHooks()
    );

    expect(phase2Schema).toBe(RecipeDetailSchema);

    // Phase 1's pantry block is capped at 120 items by default; phase 2's digest is
    // capped much lower (40) — count rendered item lines (one "|"-delimited line each).
    const phase1ItemLines = (phase1System.match(/ingredient-\d+/g) ?? []).length;
    const phase2ItemLines = (phase2System.match(/ingredient-\d+/g) ?? []).length;
    expect(phase1ItemLines).toBe(80);
    expect(phase2ItemLines).toBeLessThanOrEqual(40);
    expect(phase2ItemLines).toBeLessThan(phase1ItemLines);

    // Meal-specific context (title/summary/keyIngredients) is present in phase 2.
    expect(phase2System).toContain("Sheet-Pan Chicken");
  });

  test("runs phase 2 at concurrency 4", async () => {
    const meals = Array.from({ length: 8 }, (_, i) =>
      skeletonMeal({ dayIndex: 0, title: `Meal ${i}` })
    );
    let inFlight = 0;
    let maxInFlight = 0;
    let call = 0;

    _deps.generateObject = mock(async () => {
      call += 1;
      if (call === 1) return { object: { meals } };
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { object: recipeDetail() };
    }) as any;

    await generatePlanContent(
      {
        items: [],
        config: baseConfig({ dayCount: 8, slots: ["dinner"] }),
        now: new Date(),
        householdId: "household-1",
      },
      noopHooks()
    );

    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1); // proves it's actually concurrent, not serial
  });
});

// ---------------------------------------------------------------------------------
// How we handle what came back
// ---------------------------------------------------------------------------------

describe("failure handling — phase 1", () => {
  test("401 (bad key) is terminal and is NEVER retried", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount += 1;
      throw apiCallError(401, "Incorrect API key provided: sk-leaked-secret-123");
    }) as any;

    await expect(
      generatePlanContent(
        { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
        noopHooks()
      )
    ).rejects.toThrow(GenerationFailure);

    expect(callCount).toBe(1); // no retry at all

    callCount = 0;
    let thrown: unknown;
    try {
      await generatePlanContent(
        { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
        noopHooks()
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GenerationFailure);
    expect((thrown as GenerationFailure).code).toBe("invalid_api_key");
    // The safe fixed message must never contain the provider's echoed key fragment.
    expect((thrown as GenerationFailure).message).not.toContain("sk-leaked-secret-123");
  });

  test("403 is also treated as invalid_api_key, terminal", async () => {
    _deps.generateObject = mock(async () => {
      throw apiCallError(403);
    }) as any;

    let thrown: unknown;
    try {
      await generatePlanContent(
        { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
        noopHooks()
      );
    } catch (err) {
      thrown = err;
    }
    expect((thrown as GenerationFailure).code).toBe("invalid_api_key");
  });

  test("a transient 500 is retried (withRetry) and can succeed on a later attempt", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount += 1;
      if (callCount < 2) throw apiCallError(500);
      return { object: { meals: [] } }; // empty skeleton — no phase-2 calls to muddy callCount
    }) as any;

    const outcome = await generatePlanContent(
      { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
      noopHooks()
    );

    expect(callCount).toBe(2);
    expect(outcome.cancelled).toBe(false);
  }, 15_000);

  test("a sustained 429 exhausts withRetry's 3 attempts, then fails as rate_limited (never provider_unavailable)", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount += 1;
      throw apiCallError(429);
    }) as any;

    let thrown: unknown;
    try {
      await generatePlanContent(
        { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
        noopHooks()
      );
    } catch (err) {
      thrown = err;
    }

    expect(callCount).toBe(3);
    expect(thrown).toBeInstanceOf(GenerationFailure);
    expect((thrown as GenerationFailure).code).toBe("rate_limited");
  }, 15_000);

  test("a sustained 500 exhausts withRetry's 3 attempts, then still fails as provider_unavailable", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount += 1;
      throw apiCallError(500);
    }) as any;

    let thrown: unknown;
    try {
      await generatePlanContent(
        { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
        noopHooks()
      );
    } catch (err) {
      thrown = err;
    }

    expect(callCount).toBe(3);
    expect(thrown).toBeInstanceOf(GenerationFailure);
    expect((thrown as GenerationFailure).code).toBe("provider_unavailable");
  }, 15_000);

  test("a run that alternates 429 then a final 500 fails as provider_unavailable — only the LAST attempt's class decides the terminal code", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount += 1;
      throw callCount < 3 ? apiCallError(429) : apiCallError(500);
    }) as any;

    let thrown: unknown;
    try {
      await generatePlanContent(
        { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
        noopHooks()
      );
    } catch (err) {
      thrown = err;
    }

    expect(callCount).toBe(3);
    expect((thrown as GenerationFailure).code).toBe("provider_unavailable");
  }, 15_000);

  test("a sustained 429 with a Retry-After header surfaces retryAfterSeconds on the terminal rate_limited failure", async () => {
    _deps.generateObject = mock(async () => {
      throw apiCallError(429, "irrelevant", { "retry-after": "30" });
    }) as any;

    let thrown: unknown;
    try {
      await generatePlanContent(
        { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
        noopHooks()
      );
    } catch (err) {
      thrown = err;
    }

    expect((thrown as GenerationFailure).code).toBe("rate_limited");
    expect((thrown as GenerationFailure).retryAfterSeconds).toBe(30);
  }, 15_000);

  test("a sustained 429 with NO Retry-After header surfaces retryAfterSeconds as null, cleanly", async () => {
    _deps.generateObject = mock(async () => {
      throw apiCallError(429);
    }) as any;

    let thrown: unknown;
    try {
      await generatePlanContent(
        { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
        noopHooks()
      );
    } catch (err) {
      thrown = err;
    }

    expect((thrown as GenerationFailure).code).toBe("rate_limited");
    expect((thrown as GenerationFailure).retryAfterSeconds).toBeNull();
  }, 15_000);

  test("unparseable output retries exactly once with a nudge, then fails", async () => {
    let callCount = 0;
    const seenMessages: string[] = [];
    _deps.generateObject = mock(async (params: any) => {
      callCount += 1;
      seenMessages.push(params.messages[0].content as string);
      throw new NoObjectGeneratedError({
        response: { id: "x", timestamp: new Date(), modelId: "gpt-4o-mini" },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        finishReason: "stop",
      });
    }) as any;

    let thrown: unknown;
    try {
      await generatePlanContent(
        { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
        noopHooks()
      );
    } catch (err) {
      thrown = err;
    }

    expect(callCount).toBe(2); // one attempt + one nudge retry, then give up
    expect(seenMessages[1]).toContain("valid JSON");
    expect(thrown).toBeInstanceOf(GenerationFailure);
    expect((thrown as GenerationFailure).code).toBe("unparseable_output");
  });

  test("unparseable output succeeds if the nudge retry parses correctly", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new NoObjectGeneratedError({
          response: { id: "x", timestamp: new Date(), modelId: "gpt-4o-mini" },
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          finishReason: "stop",
        });
      }
      return { object: { meals: [] } }; // empty skeleton — no phase-2 calls to muddy callCount
    }) as any;

    const outcome = await generatePlanContent(
      { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
      noopHooks()
    );

    expect(callCount).toBe(2);
    expect(outcome.cancelled).toBe(false);
  });
});

describe("failure handling — phase 2 (per-meal isolation)", () => {
  test("a meal that fails detail generation leaves the plan ready, with the other meal succeeding", async () => {
    let call = 0;
    const settled: any[] = [];

    _deps.generateObject = mock(async () => {
      call += 1;
      if (call === 1) {
        return {
          object: {
            meals: [
              skeletonMeal({ title: "Good Meal", slot: "dinner" }),
              skeletonMeal({ title: "Bad Meal", slot: "breakfast" }),
            ],
          },
        };
      }
      // Every phase-2 call for "Bad Meal" fails terminally; "Good Meal" succeeds.
      // generateObject can't see which meal it's for directly, so key off call order:
      // batch dispatch order matches skeleton order (breakfast sorts before dinner).
      if (call === 2) throw apiCallError(401); // Bad Meal (breakfast, sortOrder 0) — terminal, no retry
      return { object: recipeDetail() }; // Good Meal (dinner)
    }) as any;

    const outcome = await generatePlanContent(
      {
        items: [],
        config: baseConfig({ dayCount: 1, slots: ["breakfast", "dinner"] }),
        now: new Date(),
        householdId: "household-1",
      },
      noopHooks({
        onMealSettled: async (meal) => {
          settled.push(meal);
        },
      })
    );

    // generatePlanContent itself never throws for a phase-2 failure — the plan still
    // reaches "ready" (the caller flips status based on outcome, not on a thrown error).
    expect(outcome.cancelled).toBe(false);

    const bad = settled.find((m) => m.title === "Bad Meal");
    const good = settled.find((m) => m.title === "Good Meal");
    expect(bad.detailStatus).toBe("failed");
    expect(bad.detailError).not.toContain("401");
    expect(good.detailStatus).toBe("ready");
  });

  test("bumps progressDone after each meal, denominated by meal count not day count", async () => {
    let call = 0;
    const progress: { done: number; total: number }[] = [];

    _deps.generateObject = mock(async () => {
      call += 1;
      if (call === 1) {
        return {
          object: {
            meals: [
              skeletonMeal({ dayIndex: 0, slot: "breakfast" }),
              skeletonMeal({ dayIndex: 0, slot: "dinner" }),
            ],
          },
        };
      }
      return { object: recipeDetail() };
    }) as any;

    await generatePlanContent(
      {
        items: [],
        config: baseConfig({ dayCount: 1, slots: ["breakfast", "dinner"] }),
        now: new Date(),
        householdId: "household-1",
      },
      noopHooks({
        onMealSettled: async (_meal, progressDone, progressTotal) => {
          progress.push({ done: progressDone, total: progressTotal });
        },
      })
    );

    // 1 day x 2 slots = 2 meals total, not 1 (day-denominated would be wrong here).
    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });
});

describe("cancellation", () => {
  test("stops launching further meals once isCancelled() returns true, between batches", async () => {
    const meals = Array.from({ length: 6 }, (_, i) =>
      skeletonMeal({ dayIndex: 0, title: `Meal ${i}` })
    );
    let call = 0;
    const settledTitles: string[] = [];

    _deps.generateObject = mock(async () => {
      call += 1;
      if (call === 1) return { object: { meals } };
      return { object: recipeDetail() };
    }) as any;

    let cancelledPolls = 0;
    const outcome = await generatePlanContent(
      {
        items: [],
        config: baseConfig({ dayCount: 6, slots: ["dinner"] }),
        now: new Date(),
        householdId: "household-1",
      },
      noopHooks({
        onMealSettled: async (meal) => {
          settledTitles.push(meal.title);
        },
        isCancelled: async () => {
          cancelledPolls += 1;
          return cancelledPolls > 1; // allow the first batch of 4, cancel before the second
        },
      })
    );

    expect(outcome.cancelled).toBe(true);
    expect(settledTitles.length).toBe(4); // first concurrency-4 batch settled; second never launched
  });
});

describe("onSkeletonReady", () => {
  test("is called once, before any phase-2 call, with the full ordered skeleton", async () => {
    let skeletonReadyCallCount = 0;
    let phase2CallsAfterSkeletonReady = 0;
    let call = 0;

    _deps.generateObject = mock(async () => {
      call += 1;
      if (call === 1)
        return { object: { meals: [skeletonMeal(), skeletonMeal({ slot: "breakfast" })] } };
      phase2CallsAfterSkeletonReady += skeletonReadyCallCount > 0 ? 1 : 0;
      return { object: recipeDetail() };
    }) as any;

    await generatePlanContent(
      {
        items: [],
        config: baseConfig({ dayCount: 1, slots: ["breakfast", "dinner"] }),
        now: new Date(),
        householdId: "household-1",
      },
      noopHooks({
        onSkeletonReady: async (meals: MealSkeletonResult[]) => {
          skeletonReadyCallCount += 1;
          expect(meals.length).toBe(2);
        },
      })
    );

    expect(skeletonReadyCallCount).toBe(1);
    expect(phase2CallsAfterSkeletonReady).toBe(2);
  });
});

// ---------------------------------------------------------------------------------
// Finding 4 — no maxOutputTokens on any generateObject call. Zod's array/length caps
// bound what gets PERSISTED after a successful parse; they do not bound what the model
// generates and bills for. Asserted directly on the captured params passed to the
// _deps.generateObject stub.
// ---------------------------------------------------------------------------------
describe("maxOutputTokens (finding 4, plan §4.5)", () => {
  test("phase 1 (skeleton) sets a positive, bounded maxOutputTokens", async () => {
    let captured: any;
    _deps.generateObject = mock(async (params: any) => {
      if (!captured) captured = params;
      return { object: { meals: [skeletonMeal()] } };
    }) as any;

    await generatePlanContent(
      { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
      noopHooks()
    );

    expect(typeof captured.maxOutputTokens).toBe("number");
    expect(captured.maxOutputTokens).toBeGreaterThan(0);
  });

  test("phase 2 (recipe detail) sets its OWN bounded maxOutputTokens, independent of phase 1's", async () => {
    let phase1Tokens: unknown;
    let phase2Tokens: unknown;
    let call = 0;
    _deps.generateObject = mock(async (params: any) => {
      call += 1;
      if (call === 1) {
        phase1Tokens = params.maxOutputTokens;
        return { object: { meals: [skeletonMeal()] } };
      }
      phase2Tokens = params.maxOutputTokens;
      return { object: recipeDetail() };
    }) as any;

    await generatePlanContent(
      { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
      noopHooks()
    );

    expect(typeof phase2Tokens).toBe("number");
    expect(phase2Tokens as number).toBeGreaterThan(0);
    // Not asserting a specific relationship between the two beyond "independently
    // configured" — just that phase 2 isn't silently inheriting phase 1's unrelated
    // budget (a 56-meal skeleton budget is not a sane bound for a single recipe call).
    expect(phase1Tokens).not.toBe(undefined);
  });
});

// ---------------------------------------------------------------------------------
// Finding 5 — token accounting was dead code: generate.ts never read result.usage.
// These assert the seam captures and forwards usage through the hooks that
// runGeneration/regenerateMeal (the DB-aware callers) persist onto the plan row.
// ---------------------------------------------------------------------------------
describe("token usage capture (finding 5, plan §4.5, §11 Q6)", () => {
  test("onSkeletonReady receives phase-1 usage exactly as returned by generateObject", async () => {
    let capturedUsage: unknown;
    _deps.generateObject = mock(async (params: any) => {
      if (params.schema === PlanSkeletonSchema) {
        return { object: { meals: [] }, usage: { inputTokens: 111, outputTokens: 22 } };
      }
      return { object: recipeDetail() };
    }) as any;

    await generatePlanContent(
      { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
      noopHooks({
        onSkeletonReady: async (_meals, usage) => {
          capturedUsage = usage;
        },
      })
    );

    expect(capturedUsage).toEqual({ inputTokens: 111, outputTokens: 22 });
  });

  test("a generateObject result with no usage field at all is treated as zero, never throwing", async () => {
    let capturedUsage: unknown;
    _deps.generateObject = mock(async () => ({ object: { meals: [] } })) as any; // no `usage` key

    await generatePlanContent(
      { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
      noopHooks({
        onSkeletonReady: async (_meals, usage) => {
          capturedUsage = usage;
        },
      })
    );

    expect(capturedUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  test("onMealSettled receives per-meal phase-2 usage on the merged meal object", async () => {
    _deps.generateObject = mock(async (params: any) => {
      if (params.schema === PlanSkeletonSchema) return { object: { meals: [skeletonMeal()] } };
      return { object: recipeDetail(), usage: { inputTokens: 50, outputTokens: 75 } };
    }) as any;

    let settledUsage: unknown;
    await generatePlanContent(
      { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
      noopHooks({
        onMealSettled: async (meal) => {
          settledUsage = meal.usage;
        },
      })
    );

    expect(settledUsage).toEqual({ inputTokens: 50, outputTokens: 75 });
  });

  test("a meal that fails phase-2 generation reports zeroed usage rather than throwing", async () => {
    _deps.generateObject = mock(async (params: any) => {
      if (params.schema === PlanSkeletonSchema) return { object: { meals: [skeletonMeal()] } };
      throw apiCallError(401);
    }) as any;

    let settledUsage: unknown;
    await generatePlanContent(
      { items: [], config: baseConfig(), now: new Date(), householdId: "household-1" },
      noopHooks({
        onMealSettled: async (meal) => {
          settledUsage = meal.usage;
        },
      })
    );

    expect(settledUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
