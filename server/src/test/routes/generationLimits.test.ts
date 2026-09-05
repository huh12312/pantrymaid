/**
 * Direct tests for lib/generationLimits.ts — the Postgres-backed replacement for the
 * process-local in-memory rate limiter (finding 3, plan §6.5: "5 generations/household
 * /hour, 30/day ... persisted in Postgres so a restart doesn't reset it"). Lives under
 * src/test/routes (not src/test/lib) because it needs a real Postgres testcontainer —
 * see src/test/db-preload.ts, which only starts one for "test/routes"/"test/integrations".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { setupTestDb, teardownTestDb, clearTables, testDb } from "../setup";
import { factories } from "../factories";
import { households, householdGenerationLimits } from "../../db/schema";
import { eq } from "drizzle-orm";
import {
  checkAndRecordGenerationLimit,
  GENERATION_HOURLY_LIMIT,
  GENERATION_HOURLY_WINDOW_MS,
  GENERATION_DAILY_LIMIT,
  GENERATION_DAILY_WINDOW_MS,
} from "../../lib/generationLimits";

describe("checkAndRecordGenerationLimit (Postgres-backed household budget, plan §6.5)", () => {
  let householdId: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTables();
    const household = factories.household();
    await testDb.insert(households).values(household);
    householdId = household.id;
  });

  it("allows up to the hourly limit, then rejects with scope 'hourly'", async () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    for (let i = 0; i < GENERATION_HOURLY_LIMIT; i++) {
      const result = await checkAndRecordGenerationLimit(householdId, now);
      expect(result.allowed).toBe(true);
    }
    const rejected = await checkAndRecordGenerationLimit(householdId, now);
    expect(rejected.allowed).toBe(false);
    expect(rejected.scope).toBe("hourly");
  });

  it("the hourly window rolls over, but the daily bucket keeps counting across it", async () => {
    const start = new Date("2026-03-01T00:00:00.000Z");
    const hoursToFillDaily = GENERATION_DAILY_LIMIT / GENERATION_HOURLY_LIMIT;

    // Spread exactly GENERATION_DAILY_LIMIT calls across successive hourly windows so
    // the hourly bucket resets each time (never itself rejecting) while the daily
    // bucket climbs all the way to its cap.
    for (let hour = 0; hour < hoursToFillDaily; hour++) {
      const windowNow = new Date(start.getTime() + hour * GENERATION_HOURLY_WINDOW_MS);
      for (let i = 0; i < GENERATION_HOURLY_LIMIT; i++) {
        const result = await checkAndRecordGenerationLimit(householdId, windowNow);
        expect(result.allowed).toBe(true);
      }
    }

    // One more hour has elapsed — the HOURLY window has rolled over (would allow 5
    // more on its own) — but fewer than 24h have passed since the DAILY window
    // started, so the daily cap (already at its limit) must still reject.
    const nextHour = new Date(start.getTime() + hoursToFillDaily * GENERATION_HOURLY_WINDOW_MS);
    const result = await checkAndRecordGenerationLimit(householdId, nextHour);
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe("daily");
  });

  it("the daily bucket resets once a full 24h has elapsed since it started", async () => {
    const start = new Date("2026-03-01T00:00:00.000Z");
    const hoursToFillDaily = GENERATION_DAILY_LIMIT / GENERATION_HOURLY_LIMIT;

    for (let hour = 0; hour < hoursToFillDaily; hour++) {
      const windowNow = new Date(start.getTime() + hour * GENERATION_HOURLY_WINDOW_MS);
      for (let i = 0; i < GENERATION_HOURLY_LIMIT; i++) {
        await checkAndRecordGenerationLimit(householdId, windowNow);
      }
    }

    const justUnderADay = new Date(start.getTime() + GENERATION_DAILY_WINDOW_MS - 1000);
    expect((await checkAndRecordGenerationLimit(householdId, justUnderADay)).allowed).toBe(false);

    const pastADay = new Date(start.getTime() + GENERATION_DAILY_WINDOW_MS + 1000);
    const result = await checkAndRecordGenerationLimit(householdId, pastADay);
    expect(result.allowed).toBe(true);
  });

  it("persists counts in a Postgres row, independent of process memory — proves restart-survival", async () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    for (let i = 0; i < GENERATION_HOURLY_LIMIT; i++) {
      await checkAndRecordGenerationLimit(householdId, now);
    }

    // Read the counters through testDb — a SEPARATE Postgres connection from the one
    // lib/generationLimits.ts uses internally (lib/db.ts's own singleton) — to prove
    // the state lives in the household_generation_limits TABLE, not in a process-local
    // JS variable. The old middleware/ratelimit.ts Map lived only in process memory and
    // was wiped by every restart; a row in this table is not.
    const [row] = await testDb
      .select()
      .from(householdGenerationLimits)
      .where(eq(householdGenerationLimits.householdId, householdId));
    expect(row).toBeDefined();
    expect(row!.hourlyCount).toBe(GENERATION_HOURLY_LIMIT);
    expect(row!.dailyCount).toBe(GENERATION_HOURLY_LIMIT);

    // A fresh call — as if this were the very first check after a brand new process
    // boot, with no warm in-memory cache of any kind — immediately observes the
    // persisted state and still rejects.
    const result = await checkAndRecordGenerationLimit(householdId, now);
    expect(result.allowed).toBe(false);
  });

  it("two households never share a bucket", async () => {
    const other = factories.household();
    await testDb.insert(households).values(other);
    const now = new Date("2026-03-01T12:00:00.000Z");

    for (let i = 0; i < GENERATION_HOURLY_LIMIT; i++) {
      expect((await checkAndRecordGenerationLimit(householdId, now)).allowed).toBe(true);
    }
    expect((await checkAndRecordGenerationLimit(householdId, now)).allowed).toBe(false);

    // A completely different household, never having made a request, is unaffected.
    const otherResult = await checkAndRecordGenerationLimit(other.id, now);
    expect(otherResult.allowed).toBe(true);
  });

  it("concurrent callers for the same household never exceed the limit (no lost-update race)", async () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    // Fire 10 concurrent checks against a limit of 5 — the row lock (SELECT ... FOR
    // UPDATE) must serialize them so exactly 5 are allowed, not more.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkAndRecordGenerationLimit(householdId, now))
    );
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(GENERATION_HOURLY_LIMIT);
  });
});
