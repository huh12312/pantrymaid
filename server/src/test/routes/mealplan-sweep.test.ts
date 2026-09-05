/**
 * Direct tests for lib/mealplan/generate.ts's `sweepStalePlans` — the boot/60s crash
 * sweep (plan §4.1) that fails any `generating_*` plan whose heartbeat has gone stale.
 * Lives under src/test/routes (not src/test/lib) because it needs a real Postgres
 * testcontainer — see src/test/db-preload.ts, which only starts one for
 * "test/routes"/"test/integrations".
 *
 * Bug fix under test: `onSkeletonReady` inserts every meal row as `detailStatus:
 * "pending"` before phase 2 runs. The sweep previously only updated the `meal_plans`
 * row to `failed`, leaving any meal rows that hadn't finished phase 2 stuck `pending`
 * forever. The client's `planNeedsPolling` (apps/web) keeps polling `GET
 * /api/meal-plans/:id` every 2s while ANY meal is `pending`, independent of the plan's
 * own status — so an orphaned pending meal after a crash sweep was an infinite
 * client-side poll loop, not just stale data. The fix bulk-fails pending meals in the
 * same transaction as the plan-level sweep.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { setupTestDb, teardownTestDb, clearTables, testDb, createAuthUserRow } from "../setup";
import { factories } from "../factories";
import { households, users, mealPlans, mealPlanDays, mealPlanMeals } from "../../db/schema";
import { eq } from "drizzle-orm";
import { sweepStalePlans } from "../../lib/mealplan/generate";

const STALE_HEARTBEAT_MS = 10 * 60 * 1000;

async function makeHousehold() {
  const household = factories.household();
  await testDb.insert(households).values(household);
  const authUser = await createAuthUserRow();
  const appUser = factories.user(household.id, { id: authUser.id });
  await testDb.insert(users).values(appUser);
  return { household, userId: appUser.id };
}

async function seedPlanWithMeals(
  householdId: string,
  requestedBy: string,
  planOverrides: Partial<Parameters<typeof factories.mealPlan>[2]>,
  mealDetailStatuses: Array<"pending" | "ready" | "failed">
) {
  const [plan] = await testDb
    .insert(mealPlans)
    .values(factories.mealPlan(householdId, requestedBy, planOverrides))
    .returning();
  const [day] = await testDb
    .insert(mealPlanDays)
    .values(factories.mealPlanDay(householdId, plan!.id))
    .returning();

  const slots = ["breakfast", "lunch", "dinner", "snack"] as const;
  const meals = [];
  for (let i = 0; i < mealDetailStatuses.length; i++) {
    const [meal] = await testDb
      .insert(mealPlanMeals)
      .values(
        factories.mealPlanMeal(householdId, plan!.id, day!.id, {
          slot: slots[i]!,
          sortOrder: i,
          detailStatus: mealDetailStatuses[i]!,
        })
      )
      .returning();
    meals.push(meal!);
  }
  return { plan: plan!, day: day!, meals };
}

describe("sweepStalePlans — no meal is ever left `pending` on a swept plan", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTables();
  });

  it("fails every pending meal on a swept plan, in the same pass", async () => {
    const { household, userId } = await makeHousehold();
    const staleHeartbeat = new Date(Date.now() - STALE_HEARTBEAT_MS - 60_000);
    const { plan, meals } = await seedPlanWithMeals(
      household.id,
      userId,
      { status: "generating_recipes", heartbeatAt: staleHeartbeat },
      ["pending", "pending", "ready"]
    );

    const sweptCount = await sweepStalePlans(new Date());
    expect(sweptCount).toBe(1);

    const [planRow] = await testDb.select().from(mealPlans).where(eq(mealPlans.id, plan.id));
    expect(planRow!.status).toBe("failed");
    expect(planRow!.errorCode).toBe("interrupted");

    const mealRows = await testDb
      .select()
      .from(mealPlanMeals)
      .where(eq(mealPlanMeals.planId, plan.id));
    // No meal is left `pending` once its parent plan has been swept to `failed`.
    expect(mealRows.some((m) => m.detailStatus === "pending")).toBe(false);

    const byId = new Map(mealRows.map((m) => [m.id, m]));
    expect(byId.get(meals[0]!.id)!.detailStatus).toBe("failed");
    expect(byId.get(meals[0]!.id)!.detailError).toBe("Generation was interrupted");
    expect(byId.get(meals[1]!.id)!.detailStatus).toBe("failed");
    // A meal that had already finished successfully is untouched by the sweep.
    expect(byId.get(meals[2]!.id)!.detailStatus).toBe("ready");
    expect(byId.get(meals[2]!.id)!.detailError).toBeNull();
  });

  it("does not touch a plan whose heartbeat is still fresh, nor its pending meals", async () => {
    const { household, userId } = await makeHousehold();
    const { plan, meals } = await seedPlanWithMeals(
      household.id,
      userId,
      { status: "generating_recipes", heartbeatAt: new Date() },
      ["pending"]
    );

    const sweptCount = await sweepStalePlans(new Date());
    expect(sweptCount).toBe(0);

    const [planRow] = await testDb.select().from(mealPlans).where(eq(mealPlans.id, plan.id));
    expect(planRow!.status).toBe("generating_recipes");

    const [mealRow] = await testDb
      .select()
      .from(mealPlanMeals)
      .where(eq(mealPlanMeals.id, meals[0]!.id));
    expect(mealRow!.detailStatus).toBe("pending");
  });

  it("a `queued` plan with no heartbeat yet falls back to `createdAt` for staleness", async () => {
    const { household, userId } = await makeHousehold();
    const staleCreatedAt = new Date(Date.now() - STALE_HEARTBEAT_MS - 60_000);
    const [plan] = await testDb
      .insert(mealPlans)
      .values(
        factories.mealPlan(household.id, userId, {
          status: "queued",
          heartbeatAt: null,
        })
      )
      .returning();
    // `createdAt` defaults to now() at insert time; force it back so this row reads as
    // stale under the `heartbeatAt ?? createdAt` fallback.
    await testDb
      .update(mealPlans)
      .set({ createdAt: staleCreatedAt })
      .where(eq(mealPlans.id, plan!.id));

    const sweptCount = await sweepStalePlans(new Date());
    expect(sweptCount).toBe(1);

    const [planRow] = await testDb.select().from(mealPlans).where(eq(mealPlans.id, plan!.id));
    expect(planRow!.status).toBe("failed");
  });
});
