import { describe, test, expect } from "bun:test";
import path from "path";

/**
 * Proves the `MEAL_PLAN_FIXTURE` Layer-2 e2e hook in `lib/mealplan/generate.ts` (plan
 * §8) is gated on `NODE_ENV === "test"` evaluated ONCE at module load, and specifically
 * that it is INERT when `NODE_ENV` is production — even when `MEAL_PLAN_FIXTURE` is
 * set to a perfectly valid, schema-honest payload.
 *
 * Why this spawns a subprocess instead of importing `generate.ts` directly: the gate
 * is a plain `const` fixed at first import, by design (so nothing can flip it after
 * the fact — see the comment above `FIXTURE_GATE_ENABLED_AT_LOAD` in generate.ts). That
 * means a single bun:test process can only ever observe ONE of the two states for a
 * given module instance. Proving BOTH — "on" in test, "off" in production — requires a
 * fresh process per state, via `fixture-gate-harness.ts`.
 */

const HARNESS_PATH = path.join(__dirname, "fixture-gate-harness.ts");

const VALID_FIXTURE = JSON.stringify({
  skeleton: {
    meals: [
      {
        dayIndex: 0,
        slot: "dinner",
        title: "FIXTURE-SKELETON-TITLE",
        summary: "A fixture-supplied summary that must never appear in production.",
        servings: 2,
        keyIngredients: ["fixture-ingredient"],
      },
    ],
  },
  details: {
    "0:dinner": {
      prepMinutes: 5,
      cookMinutes: 10,
      ingredients: [],
      steps: ["FIXTURE-DETAIL-STEP-ONE", "FIXTURE-DETAIL-STEP-TWO"],
    },
  },
});

interface HarnessResult {
  generateObjectCalls: number;
  skeletonTitle: string | null;
  detailFirstStep: string | null;
}

function runHarness(env: Record<string, string | undefined>): HarnessResult {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", HARNESS_PATH],
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://u:p@localhost:5432/db",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `harness exited ${result.exitCode}\nstdout: ${result.stdout.toString()}\nstderr: ${result.stderr.toString()}`
    );
  }

  return JSON.parse(result.stdout.toString()) as HarnessResult;
}

describe("MEAL_PLAN_FIXTURE gate (plan §8 Layer 2)", () => {
  test("is INERT under NODE_ENV=production: real generateObject seam is called, fixture text never surfaces, even with a valid fixture set", () => {
    const result = runHarness({ NODE_ENV: "production", MEAL_PLAN_FIXTURE: VALID_FIXTURE });

    expect(result.generateObjectCalls).toBe(2); // phase 1 + the one requested meal's phase 2
    expect(result.skeletonTitle).toBe("STUB-SKELETON-MARKER");
    expect(result.detailFirstStep).toBe("STUB-DETAIL-STEP-ONE");
    // Never leaks into output even though the env var held it.
    expect(result.skeletonTitle).not.toContain("FIXTURE");
    expect(result.detailFirstStep).not.toContain("FIXTURE");
  });

  test("is INERT under NODE_ENV=development (the local default) with a valid fixture set", () => {
    const result = runHarness({ NODE_ENV: "development", MEAL_PLAN_FIXTURE: VALID_FIXTURE });

    expect(result.generateObjectCalls).toBe(2);
    expect(result.skeletonTitle).toBe("STUB-SKELETON-MARKER");
    expect(result.detailFirstStep).toBe("STUB-DETAIL-STEP-ONE");
  });

  test("sanity check — the hook IS active under NODE_ENV=test with a valid fixture set (so the two tests above aren't passing merely because the mechanism never works)", () => {
    const result = runHarness({ NODE_ENV: "test", MEAL_PLAN_FIXTURE: VALID_FIXTURE });

    expect(result.generateObjectCalls).toBe(0); // real seam never reached
    expect(result.skeletonTitle).toBe("FIXTURE-SKELETON-TITLE");
    expect(result.detailFirstStep).toBe("FIXTURE-DETAIL-STEP-ONE");
  });

  test("NODE_ENV=test alone, with MEAL_PLAN_FIXTURE unset, does not short-circuit anything", () => {
    const result = runHarness({ NODE_ENV: "test", MEAL_PLAN_FIXTURE: undefined });

    expect(result.generateObjectCalls).toBe(2);
    expect(result.skeletonTitle).toBe("STUB-SKELETON-MARKER");
  });

  test("NODE_ENV=production with a malformed fixture also falls through safely (not just inert by env — inert on bad input too)", () => {
    const result = runHarness({
      NODE_ENV: "production",
      MEAL_PLAN_FIXTURE: JSON.stringify({ skeleton: { meals: [{ nonsense: true }] } }),
    });

    expect(result.generateObjectCalls).toBe(2);
    expect(result.skeletonTitle).toBe("STUB-SKELETON-MARKER");
  });
});
