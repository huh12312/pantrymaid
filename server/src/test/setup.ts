import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { runMigrations } from "../lib/migrate";
import * as schema from "../db/schema";
import { auth } from "../lib/auth";
import { convertSetCookieToCookie } from "better-auth/test";

let testDb: ReturnType<typeof drizzle<typeof schema>>;
let testClient: postgres.Sql;

/**
 * Open a test DB client and run migrations.
 * Call this at the beginning of test suites.
 *
 * The Postgres container itself is started once, process-wide, by
 * src/test/db-preload.ts (a bun test preload — see bunfig.toml) *before* this module
 * or any test file is imported. That ordering matters: server/src/lib/db.ts (the
 * connection the app's routes and Better Auth actually query through) resolves
 * DATABASE_URL into a singleton once, at import time, so DATABASE_URL must already
 * point at the test container by the time anything first imports lib/db — long before
 * a per-file beforeAll() would get a chance to run. See db-preload.ts for the full
 * explanation.
 */
export async function setupTestDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Route/integration tests expect src/test/db-preload.ts " +
        "(wired via bunfig.toml's [test] preload) to start a shared Postgres " +
        "testcontainer and set DATABASE_URL before any test file is imported — running " +
        "this file outside `bun test src/test/routes` or `src/test/integrations` won't " +
        "trigger that preload."
    );
  }

  // Create client and drizzle instance
  testClient = postgres(connectionString, { max: 1 });
  testDb = drizzle(testClient, { schema });

  // Run migrations using custom runner (avoids Bun bigint comparison bug). Idempotent —
  // safe to call once per test file even though they all share one container.
  await runMigrations(testClient, "./drizzle");

  return { db: testDb, connectionString };
}

/**
 * Close this file's test DB client.
 * Call this at the end of test suites.
 *
 * Does NOT stop the underlying container — it's shared across every route test file
 * in the process (see db-preload.ts) and is torn down by testcontainers' Ryuk reaper
 * when the test process exits.
 */
export async function teardownTestDb() {
  if (testClient) {
    await testClient.end();
  }
}

/**
 * Clear all tables between tests, in FK-safe order.
 *
 * `user` (Better Auth) is the root of the FK chain: `users` (the app table)
 * references `user.id`, and `session`/`account` also reference `user.id`. All of
 * those must be gone before `user` rows can be deleted.
 */
export async function clearTables() {
  if (!testDb) {
    throw new Error("Test database not initialized. Call setupTestDb() first.");
  }

  // Clear tables in correct order (respecting foreign keys). Meal-plan tables cascade
  // from `meal_plans` -> days -> meals -> ingredients, but ingredients also reference
  // `items` and `shopping_list_items` (ON DELETE SET NULL, not CASCADE), so those two
  // must go first or the later `items`/`shopping_list_items` deletes are harmless
  // no-ops anyway — deleting meal_plan_ingredients explicitly first keeps the order
  // legible regardless.
  await testDb.delete(schema.mealPlanIngredients);
  await testDb.delete(schema.mealPlanMeals);
  await testDb.delete(schema.mealPlanDays);
  await testDb.delete(schema.mealPlans);
  await testDb.delete(schema.mealPlanPrompts);
  await testDb.delete(schema.householdLlmSettings);
  await testDb.delete(schema.householdGenerationLimits);
  await testDb.delete(schema.shoppingListItems);
  await testDb.delete(schema.items);
  await testDb.delete(schema.session);
  await testDb.delete(schema.account);
  await testDb.delete(schema.users);
  await testDb.delete(schema.households);
  await testDb.delete(schema.user);
  await testDb.delete(schema.verification);
  await testDb.delete(schema.productCache);
}

export interface TestSession {
  id: string;
  email: string;
  name: string;
  /** Value for a request's `Cookie` header — accepted by authMiddleware's real session lookup. */
  cookie: string;
}

/**
 * Creates a real Better Auth user + session via the production `auth.api`, and
 * returns a `Cookie` header value that authMiddleware's `auth.api.getSession()` will
 * accept.
 *
 * Route tests previously sent a fabricated `Authorization: Bearer mock-token-<id>`
 * header. authMiddleware only recognizes real Better Auth sessions — session lookup
 * is cookie-based and no bearer plugin is registered — so that header never actually
 * authenticated anything; every route exercising real auth silently 401'd regardless
 * of what test fixtures were inserted.
 *
 * This calls `auth.api.signUpEmail` directly (bypassing the Hono app's
 * `/api/auth/*` handler in src/index.ts), so the app's post-signup
 * default-household side effect does NOT run here — tests remain in control of
 * which household (if any) the resulting `users` row belongs to.
 */
export async function createTestSession(
  overrides?: Partial<{ email: string; name: string; password: string }>
): Promise<TestSession> {
  const email = overrides?.email ?? `${crypto.randomUUID()}@test.pantrymaid.local`;
  const name = overrides?.name ?? "Test User";
  const password = overrides?.password ?? "Test-Password-1234!";

  const response = await auth.api.signUpEmail({
    body: { email, name, password },
    asResponse: true,
  });

  if (!response.ok) {
    throw new Error(
      `createTestSession: sign-up failed (${response.status}): ${await response.text()}`
    );
  }

  const { user } = (await response.clone().json()) as { user: { id: string } };

  const cookie = convertSetCookieToCookie(response.headers).get("cookie") ?? "";
  if (!cookie) {
    throw new Error("createTestSession: sign-up response had no Set-Cookie header");
  }

  return { id: user.id, email, name, cookie };
}

/**
 * Inserts just the Better Auth `user` row (schema.ts:5) that the app `users` table
 * (schema.ts:76) foreign-keys against — `users.id references user.id`. Use this for
 * fixture users a test never authenticates as (e.g. "another household's member" in an
 * IDOR test): they need to satisfy that FK constraint but don't need a real session,
 * so this skips signUpEmail's password hashing / session creation entirely.
 *
 * For a user the test actually authenticates as, use createTestSession() instead.
 */
export async function createAuthUserRow(
  overrides?: Partial<{ id: string; email: string; name: string }>
): Promise<{ id: string; email: string; name: string }> {
  const row = {
    id: overrides?.id ?? crypto.randomUUID(),
    email: overrides?.email ?? `${crypto.randomUUID()}@test.pantrymaid.local`,
    name: overrides?.name ?? "Test User",
    emailVerified: true,
  };
  await testDb.insert(schema.user).values(row);
  return row;
}

export { testDb, testClient };
