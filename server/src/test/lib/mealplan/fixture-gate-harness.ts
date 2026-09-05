/**
 * Out-of-process harness for `generate.fixture-gate.test.ts`.
 *
 * This file is never imported by the bun:test process itself — it is only ever run
 * as a fresh `bun run` subprocess, spawned with an explicit `NODE_ENV` and (usually) a
 * `MEAL_PLAN_FIXTURE` value. That is the whole point: `generate.ts`'s
 * `FIXTURE_GATE_ENABLED_AT_LOAD` constant is fixed the instant the module is first
 * imported, so the only way to actually observe both the "test" and "production"
 * states is to import the module fresh in a brand new process for each state — doing
 * it in-process (e.g. mutating `process.env.NODE_ENV` mid-test) would prove nothing,
 * since a real Node/Bun process never re-reads that constant after startup either.
 *
 * Protocol: prints one line of JSON to stdout and exits 0. The parent test parses it.
 */

import { _deps } from "../../../lib/llm";
import { PlanSkeletonSchema, RecipeDetailSchema } from "../../../lib/mealplan/schema";
import {
  generatePlanContent,
  type GenerationConfig,
  type GenerationHooks,
} from "../../../lib/mealplan/generate";

let generateObjectCalls = 0;

// A recognizable, obviously-not-from-the-fixture stub. If the fixture gate is
// (mis)active, the captured title/step below will be the FIXTURE's text instead of
// this stub's — that's exactly the failure this harness is built to expose.
_deps.generateObject = (async (params: { schema: unknown }) => {
  generateObjectCalls += 1;
  if (params.schema === PlanSkeletonSchema) {
    return {
      object: {
        meals: [
          {
            dayIndex: 0,
            slot: "dinner",
            title: "STUB-SKELETON-MARKER",
            summary: "Stub summary, never the fixture.",
            servings: 2,
            keyIngredients: ["stub-ingredient"],
          },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
  if (params.schema === RecipeDetailSchema) {
    return {
      object: {
        prepMinutes: 1,
        cookMinutes: 1,
        ingredients: [],
        steps: ["STUB-DETAIL-STEP-ONE", "STUB-DETAIL-STEP-TWO"],
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
  throw new Error("fixture-gate-harness: unexpected schema");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

let skeletonTitle: string | null = null;
let detailFirstStep: string | null = null;

const hooks: GenerationHooks = {
  async onSkeletonReady(meals) {
    skeletonTitle = meals[0]?.title ?? null;
  },
  async onMealSettled(meal) {
    detailFirstStep = meal.instructions[0] ?? null;
  },
  async isCancelled() {
    return false;
  },
};

const config: GenerationConfig = {
  provider: "openai",
  model: "gpt-4o-mini",
  apiKey: "sk-harness-key-never-a-real-key",
  dayCount: 1,
  slots: ["dinner"],
  mode: "balanced",
  includeExpired: false,
  servings: 2,
  allergies: [],
  dietaryRestrictions: [],
  userTemplate: "Plan {{DAYS}} day(s) for {{HOUSEHOLD}}, {{SERVINGS}} servings.\n{{PANTRY}}",
  householdName: "Harness Household",
};

await generatePlanContent(
  { items: [], config, now: new Date("2026-01-01T12:00:00Z"), householdId: "harness-household" },
  hooks
);

process.stdout.write(JSON.stringify({ generateObjectCalls, skeletonTitle, detailFirstStep }));
