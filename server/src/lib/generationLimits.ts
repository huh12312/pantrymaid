/**
 * Postgres-backed generation rate limiting (plan §6.5).
 *
 * `checkRateLimit` in `middleware/ratelimit.ts` is a process-local `Map` — a deploy or
 * crash refills every household's quota instantly, and there is no daily cap paired
 * with the hourly one. Any limit protecting a paid LLM call must key on
 * `householdId`/`userId` from the session AND be persisted in Postgres so a restart
 * doesn't reset it (plan §6.5: "5 generations/household/hour, 30/day").
 *
 * Both windows are rolling (reset when the elapsed time since the window started
 * exceeds its duration), checked and incremented atomically inside a single
 * transaction using `SELECT ... FOR UPDATE` to serialize concurrent callers for the
 * same household. The row is guaranteed to exist (via `onConflictDoNothing` before the
 * lock) so the very first request for a household doesn't race an INSERT against the
 * lock read.
 *
 * This same limiter backs BOTH full-plan generation (`POST /api/meal-plans`) and
 * single-meal regeneration (`POST /api/meal-plans/:id/meals/:mealId/regenerate`) —
 * they draw from the identical household LLM budget, so regenerate must count against
 * the same buckets or it becomes a way to bypass the cost control entirely.
 */

import { eq } from "drizzle-orm";
import { db } from "./db";
import { householdGenerationLimits } from "../db/schema";

export const GENERATION_HOURLY_LIMIT = 5;
export const GENERATION_HOURLY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const GENERATION_DAILY_LIMIT = 30;
export const GENERATION_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export type GenerationLimitScope = "hourly" | "daily";

export interface GenerationLimitResult {
  allowed: boolean;
  /** Which bucket rejected the request; null when allowed. */
  scope: GenerationLimitScope | null;
}

/**
 * Atomically checks and (if allowed) records one generation against a household's
 * hourly and daily buckets. Returns `{ allowed: false, scope: "hourly" | "daily" }`
 * without incrementing anything when either bucket is exhausted.
 */
export async function checkAndRecordGenerationLimit(
  householdId: string,
  now: Date = new Date()
): Promise<GenerationLimitResult> {
  return db.transaction(async (tx) => {
    // Ensure a row exists before locking — SELECT ... FOR UPDATE on a nonexistent row
    // locks nothing, which would let two concurrent first-time requests both pass.
    await tx
      .insert(householdGenerationLimits)
      .values({
        householdId,
        hourlyWindowStart: now,
        hourlyCount: 0,
        dailyWindowStart: now,
        dailyCount: 0,
      })
      .onConflictDoNothing({ target: householdGenerationLimits.householdId });

    const [row] = await tx
      .select()
      .from(householdGenerationLimits)
      .where(eq(householdGenerationLimits.householdId, householdId))
      .for("update");

    // Should be unreachable (the insert above guarantees the row), but fail closed
    // rather than throw if it somehow is.
    if (!row) return { allowed: false, scope: "hourly" };

    let hourlyWindowStart = row.hourlyWindowStart;
    let hourlyCount = row.hourlyCount;
    let dailyWindowStart = row.dailyWindowStart;
    let dailyCount = row.dailyCount;

    if (now.getTime() - hourlyWindowStart.getTime() >= GENERATION_HOURLY_WINDOW_MS) {
      hourlyWindowStart = now;
      hourlyCount = 0;
    }
    if (now.getTime() - dailyWindowStart.getTime() >= GENERATION_DAILY_WINDOW_MS) {
      dailyWindowStart = now;
      dailyCount = 0;
    }

    let scope: GenerationLimitScope | null = null;
    if (hourlyCount >= GENERATION_HOURLY_LIMIT) {
      scope = "hourly";
    } else if (dailyCount >= GENERATION_DAILY_LIMIT) {
      scope = "daily";
    }

    const allowed = scope === null;
    if (allowed) {
      hourlyCount += 1;
      dailyCount += 1;
    }

    await tx
      .update(householdGenerationLimits)
      .set({ hourlyWindowStart, hourlyCount, dailyWindowStart, dailyCount })
      .where(eq(householdGenerationLimits.householdId, householdId));

    return { allowed, scope };
  });
}
