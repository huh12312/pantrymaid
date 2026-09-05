/**
 * Two-phase LLM meal-plan generation worker (plan §2.2, §4.1, §4.2, §4.5, §8).
 *
 * `generatePlanContent` is the seam: it takes `{ items, config, now, householdId }` as
 * arguments and calls `_deps.generateObject` (via `../llm`) — it never fetches
 * inventory itself, never calls `new Date()`, and never reads `process.env`. Progress
 * reporting, persistence, and cancellation are pushed out through the `hooks`
 * parameter so this function stays a seam-only module: the only thing a unit test
 * needs to fake is `_deps.generateObject` (already the sole seam per plan §8) plus
 * trivial in-memory stub hooks — no DB, no testcontainers.
 *
 * `runGeneration` is the DB-aware wrapper routes call fire-and-forget
 * (`void runGeneration(id, slots).catch(...)`, the pattern at `routes/items.ts:90`).
 * It fetches the frozen plan row + household settings + inventory, decrypts the
 * household's API key, and wires real Postgres-backed hooks into
 * `generatePlanContent`.
 */

import { APICallError, NoObjectGeneratedError } from "ai";
import { eq, and, ne, inArray, sql } from "drizzle-orm";
import {
  PlanSkeletonSchema,
  RecipeDetailSchema,
  type PlanSkeletonMeal,
  type PlanSkeleton,
  type RecipeDetail,
} from "./schema";
import {
  buildSystemPrompt,
  renderInventoryBlock,
  sanitizeItemField,
  daysUntil,
  type PantryItem,
  type HardConstraints,
} from "./prompt";
import { reconcilePlan, type IngredientOccurrence, type ReconciledIngredient } from "./reconcile";
import {
  _deps as llmDeps,
  getModelForHousehold,
  resolveLLMCredentials,
  type HouseholdLLMProvider,
} from "../llm";
import { withRetry, RetryError, isRateLimitError, getRetryAfterMs } from "../retry";
import { SecretDecryptionError, type EncryptedSecret } from "../crypto";
import { db } from "../db";
import {
  mealPlans,
  mealPlanDays,
  mealPlanMeals,
  mealPlanIngredients,
  householdLlmSettings,
  households,
  items as itemsTable,
} from "../../db/schema";

// ---------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export type MealPlanMode = "balanced" | "expiring_first";

/** Canonical slot ordering for `sort_order` (plan §11.1), independent of model emission order. */
const SLOT_ORDER: readonly MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

function slotSortIndex(slot: MealSlot): number {
  const idx = SLOT_ORDER.indexOf(slot);
  return idx === -1 ? SLOT_ORDER.length : idx;
}

/**
 * Fixed error-code enum for generation failures (plan §4.5, §6.2). Every provider
 * error is caught and mapped to one of these — never the provider's raw message,
 * which routinely echoes the submitted API key (plan §6.2).
 */
export type GenerationErrorCode =
  | "invalid_api_key"
  | "provider_unavailable"
  | "rate_limited"
  | "unparseable_output"
  | "timeout"
  | "cancelled"
  | "interrupted"
  | "internal_error";

/** A safe, fixed message per error code — never provider text, never the prompt/response. */
const SAFE_ERROR_MESSAGES: Record<GenerationErrorCode, string> = {
  invalid_api_key: "The stored API key was rejected by the provider.",
  provider_unavailable: "The AI provider is temporarily unavailable.",
  rate_limited: "The AI provider is rate-limiting requests.",
  unparseable_output: "The model did not return output matching the expected format.",
  timeout: "The request to the AI provider timed out.",
  cancelled: "Generation was cancelled.",
  interrupted: "Generation was interrupted by a server restart.",
  // Distinct from `provider_unavailable` (plan §4.5, §6.2): this is an unexpected bug
  // in OUR code (a DB constraint violation, a null deref, a Zod failure outside the LLM
  // call path) caught by runGeneration's outer catch-all, never a provider response.
  // `provider_unavailable` must stay reserved for genuine provider failures so it keeps
  // meaning "retry later, it's not us" — an internal bug is a different signal entirely.
  internal_error: "An unexpected internal error occurred while generating this plan.",
};

/**
 * Terminal, plan-level failure (phase 1). Never carries provider-originated text.
 *
 * `retryAfterSeconds` is only ever populated for `code === "rate_limited"`, and only
 * when the provider's final 429 carried a parseable `Retry-After` header (plan §5.5:
 * "retry in Ns"). It is a plain clamped integer — never provider response text (plan
 * §6.2).
 */
export class GenerationFailure extends Error {
  constructor(
    public readonly code: GenerationErrorCode,
    public readonly retryAfterSeconds: number | null = null
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "GenerationFailure";
  }
}

export interface GenerationConfig {
  provider: HouseholdLLMProvider;
  model: string;
  apiKey: string;
  dayCount: number;
  /** Requested slots, applied to every day (plan §11.1). */
  slots: MealSlot[];
  mode: MealPlanMode;
  includeExpired: boolean;
  servings: number;
  allergies: string[];
  dietaryRestrictions: string[];
  /** The household's saved prompt template body (already frozen as prompt_snapshot). */
  userTemplate: string;
  householdName: string;
}

export interface MealSkeletonResult {
  dayIndex: number;
  slot: MealSlot;
  sortOrder: number;
  title: string;
  summary: string;
  servings: number;
  keyIngredients: string[];
}

/**
 * Token accounting (plan §4.5 cost control, §11 Q6 the "~12k tokens · ~$0.01" line).
 * Zeroed rather than omitted when a call never returns usage (e.g. a terminal failure
 * before any response, or a test stub that doesn't set it) so callers can always add
 * these directly without a null check.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

function usageFromResult(
  usage: { inputTokens?: number; outputTokens?: number } | undefined
): TokenUsage {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  };
}

// ---------------------------------------------------------------------------------
// Layer-2 e2e fixture hook (plan §8) — lets a persistence-focused spec exercise the
// REAL generation + persistence path (this module, `reconcile.ts`, and the DB writes
// in `runGeneration`'s hooks) without a live LLM call, by having the phase-1/phase-2
// call sites below return canned, schema-validated output instead of ever reaching
// `_deps.generateObject`.
//
// Gated on `NODE_ENV === "test"` evaluated exactly ONCE, right here, at module load —
// never re-read per call. That gate is deliberately a plain `const`, not part of the
// mutable `_deps` object: `_deps.generateObject` is swappable per test by design (see
// `../llm`), but this fixture short-circuit must not be flippable at runtime by
// anything after the module has been imported once, including another test file that
// happens to `process.env.NODE_ENV = "test"` mid-run. A process that imports this
// module with `NODE_ENV=production` gets `FIXTURE_GATE_ENABLED_AT_LOAD === false`
// forever, regardless of what `MEAL_PLAN_FIXTURE` is set to — the fixture branch below
// never even reads the env var in that case. See
// `server/src/test/lib/mealplan/generate.fixture-gate.test.ts` for the proof (run out
// of process, since the gate can't be un-fixed inside a single process to test both
// states).
// ---------------------------------------------------------------------------------

const FIXTURE_GATE_ENABLED_AT_LOAD = process.env.NODE_ENV === "test";

/**
 * Shape read from the `MEAL_PLAN_FIXTURE` env var: a phase-1 skeleton response plus
 * zero or more phase-2 recipe-detail responses, keyed `${dayIndex}:${slot}` to match
 * a specific requested meal. Each piece is validated against the real output schemas
 * before use (plan §8: "schema-honest, not content-honest") — a malformed fixture
 * simply falls through to a real/stubbed `_deps.generateObject` call rather than
 * silently persisting garbage.
 */
interface MealPlanFixturePayload {
  skeleton?: unknown;
  /** Keyed `${dayIndex}:${slot}`, e.g. `"0:dinner"`. */
  details?: Record<string, unknown>;
}

let cachedFixture: { raw: string; parsed: MealPlanFixturePayload | null } | null = null;

/** Parses `MEAL_PLAN_FIXTURE` at most once per distinct value (a test may change it
 * between cases within the same process). Returns null immediately, without touching
 * `process.env` at all, when the load-time gate is off. */
function loadFixturePayload(): MealPlanFixturePayload | null {
  if (!FIXTURE_GATE_ENABLED_AT_LOAD) return null;
  const raw = process.env.MEAL_PLAN_FIXTURE;
  if (!raw) return null;
  if (cachedFixture && cachedFixture.raw === raw) return cachedFixture.parsed;
  let parsed: MealPlanFixturePayload | null;
  try {
    const value: unknown = JSON.parse(raw);
    parsed = value !== null && typeof value === "object" ? (value as MealPlanFixturePayload) : null;
  } catch {
    parsed = null;
  }
  cachedFixture = { raw, parsed };
  return parsed;
}

/** Phase-1 fixture lookup. Null unless the gate is on, `MEAL_PLAN_FIXTURE` is set, and
 * its `skeleton` validates against `PlanSkeletonSchema` — callers fall through to a
 * real/stubbed `_deps.generateObject` call in every other case. */
function fixtureSkeletonResponse(): { object: PlanSkeleton; usage: TokenUsage } | null {
  const fixture = loadFixturePayload();
  if (!fixture?.skeleton) return null;
  const result = PlanSkeletonSchema.safeParse(fixture.skeleton);
  if (!result.success) return null;
  return { object: result.data, usage: ZERO_USAGE };
}

/** Phase-2 fixture lookup for one meal, keyed the same way the caller identifies it. */
function fixtureDetailResponse(key: string): { object: RecipeDetail; usage: TokenUsage } | null {
  const fixture = loadFixturePayload();
  const raw = fixture?.details?.[key];
  if (raw === undefined) return null;
  const result = RecipeDetailSchema.safeParse(raw);
  if (!result.success) return null;
  return { object: result.data, usage: ZERO_USAGE };
}

export interface MealDetailResult {
  dayIndex: number;
  slot: MealSlot;
  detailStatus: "ready" | "failed";
  detailError: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  instructions: string[];
  /** Reconciled per-occurrence ingredient rows for this meal only (empty when failed). */
  ingredients: ReconciledIngredient[];
  /** Tokens billed for this meal's phase-2 call; zeroed on failure with no usage available. */
  usage: TokenUsage;
}

export interface GenerationHooks {
  /** Called once, immediately after phase 1 succeeds, with the ordered meal skeleton and its token usage. */
  onSkeletonReady(meals: MealSkeletonResult[], usage: TokenUsage): Promise<void>;
  /** Called after each meal's phase-2 attempt settles (success or failure), in completion order. */
  onMealSettled(
    meal: MealSkeletonResult & MealDetailResult,
    progressDone: number,
    progressTotal: number
  ): Promise<void>;
  /** Polled between phase-2 dispatch batches. Returning true stops launching further meals. */
  isCancelled(): Promise<boolean>;
}

export interface GenerationOutcome {
  /** priorityCoverage: fraction of the priority (expiring/opened) set actually used, or null in balanced mode / empty priority set. */
  priorityCoverage: number | null;
  cancelled: boolean;
}

const PHASE1_TIMEOUT_MS = 60_000;
const PHASE2_TIMEOUT_MS = 60_000;
const PHASE2_CONCURRENCY = 4;
/** Small pantry digest for phase 2 (plan §2.2: "~400-token pantry digest", NOT the full inventory). */
const PHASE2_DIGEST_MAX_ITEMS = 40;
/**
 * Zod array caps (plan §4.2) bound what gets PERSISTED after a successful parse — they
 * do NOT bound what the model generates and bills for. A degenerate/looping completion
 * would otherwise burn the household's budget and hold the 60s window regardless (plan
 * §4.5). Phase 1 caps at 56 meals (dayCount<=14 x slots<=4); ~280 tokens/meal
 * (title+summary+servings+up to 8 keyIngredients) x 56 + JSON overhead comfortably
 * fits in 16k. Phase 2 is a single recipe: up to 25 ingredients (~40 tokens each) plus
 * up to 20 steps at up to 1000 chars (~250 tokens) each — 6k covers the worst case with
 * headroom.
 */
const PHASE1_MAX_OUTPUT_TOKENS = 16_000;
const PHASE2_MAX_OUTPUT_TOKENS = 6_000;
const UNPARSEABLE_NUDGE =
  "Your previous response could not be parsed as valid JSON matching the required schema. Respond again with ONLY valid JSON matching the schema exactly.";
/**
 * Clamp for the `Retry-After` value surfaced to the UI on a terminal `rate_limited`
 * failure (plan §5.5: "retry in Ns"). Deliberately much larger than
 * `callWithProviderRetry`'s own `maxDelayMs` (2s) — that value bounds this module's
 * internal backoff pacing, not a sane upper bound for a number shown to a human.
 */
const RATE_LIMIT_RETRY_AFTER_MAX_MS = 5 * 60_000;

// ---------------------------------------------------------------------------------
// Error classification (plan §4.5, §6.2) — the ONLY place provider errors are inspected.
// ---------------------------------------------------------------------------------

type RawErrorClass =
  | "invalid_api_key"
  | "rate_limited"
  | "provider_unavailable"
  | "unparseable_output"
  | "timeout";

function classifyRawError(error: unknown): RawErrorClass {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) return "invalid_api_key";
    if (error.statusCode === 429) return "rate_limited";
    return "provider_unavailable";
  }
  if (NoObjectGeneratedError.isInstance(error)) return "unparseable_output";
  // Unknown shape (network error, etc.) — treated as a transient provider issue so it's
  // retried rather than immediately failing the whole plan.
  return "provider_unavailable";
}

/**
 * Runs `callOnce` with provider-transient-error backoff via `withRetry` (3 attempts
 * total, plan §4.5). `withRetry`'s `shouldRetry` predicate stops the loop immediately
 * — no sleep, no further network call — for the two error classes that must never
 * consume a backoff attempt:
 * - `invalid_api_key` must never be retried at all — retrying a bad key trips
 *   provider abuse limits (plan §4.5).
 * - `unparseable_output` has its own one-shot nudge-retry policy (a different call,
 *   made by the caller below), so it must not also consume `withRetry`'s backoff
 *   attempts against the identical request.
 * Rethrows the ORIGINAL error for unparseable-output failures so the caller's
 * nudge-retry loop (a different policy — no backoff, different message) can see it.
 */
async function callWithProviderRetry<T>(callOnce: () => Promise<T>): Promise<T> {
  try {
    // 1 initial + 2 retries = 3 attempts total. Tuned shorter than retry.ts's 1s/10s
    // defaults — these attempts guard a synchronous HTTP request in a fire-and-forget
    // worker, not a background job where multi-second backoff is free.
    return await withRetry(callOnce, {
      maxRetries: 2,
      initialDelayMs: 250,
      maxDelayMs: 2_000,
      shouldRetry: (error) => {
        const cls = classifyRawError(error);
        return cls !== "invalid_api_key" && cls !== "unparseable_output";
      },
    });
  } catch (error) {
    const inner = error instanceof RetryError ? error.lastError : error;
    const rawClass = classifyRawError(inner);
    if (rawClass === "unparseable_output") throw inner; // let the nudge-retry loop handle it
    if (rawClass === "invalid_api_key") throw new GenerationFailure("invalid_api_key");
    if (rawClass === "timeout") throw new GenerationFailure("timeout");
    if (rawClass === "rate_limited") {
      // Only the FINAL attempt's error class decides the terminal code — a run that
      // was 429 then 429 then 500 fails as provider_unavailable, not rate_limited,
      // per plan §5.5 (rate-limited is its own distinct terminal state only when
      // sustained rate limiting is what actually exhausted retries).
      const retryAfterMs = isRateLimitError(inner)
        ? getRetryAfterMs(inner, RATE_LIMIT_RETRY_AFTER_MAX_MS)
        : null;
      const retryAfterSeconds = retryAfterMs !== null ? Math.ceil(retryAfterMs / 1000) : null;
      throw new GenerationFailure("rate_limited", retryAfterSeconds);
    }
    throw new GenerationFailure("provider_unavailable");
  }
}

/**
 * Full failure-handling policy for a single LLM call that may need a "valid JSON"
 * nudge (plan §4.5): try once, and on an unparseable response, retry exactly once
 * more with a nudge appended to the user message. Any other error class (terminal or
 * exhausted-provider-retries) propagates immediately without a nudge attempt.
 */
async function callWithFailurePolicy<T>(makeCall: (nudge?: string) => Promise<T>): Promise<T> {
  try {
    return await callWithProviderRetry(() => makeCall());
  } catch (error) {
    if (error instanceof GenerationFailure) throw error;
    // Only unparseable-output errors reach here (provider-retry-exhausted errors are
    // already wrapped in GenerationFailure above).
    try {
      return await callWithProviderRetry(() => makeCall(UNPARSEABLE_NUDGE));
    } catch {
      throw new GenerationFailure("unparseable_output");
    }
  }
}

// ---------------------------------------------------------------------------------
// Requested slot plan — deterministic text describing exactly which day/slot
// combinations the model must produce (dayCount x slots, plan §11.1).
// ---------------------------------------------------------------------------------

function buildRequestedMealList(
  dayCount: number,
  slots: MealSlot[]
): { dayIndex: number; slot: MealSlot }[] {
  const sortedSlots = [...slots].sort((a, b) => slotSortIndex(a) - slotSortIndex(b));
  const requested: { dayIndex: number; slot: MealSlot }[] = [];
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    for (const slot of sortedSlots) {
      requested.push({ dayIndex, slot });
    }
  }
  return requested;
}

function formatRequestedMealList(requested: { dayIndex: number; slot: MealSlot }[]): string {
  return requested.map((m) => `Day ${m.dayIndex}: ${m.slot}`).join("\n");
}

// ---------------------------------------------------------------------------------
// Priority coverage (plan §4.3) — fraction of the priority (urgent + opened, up to 15
// names) ingredient set actually referenced by the generated skeleton's keyIngredients.
// ---------------------------------------------------------------------------------

function computePriorityCoverage(
  items: readonly PantryItem[],
  now: Date,
  mode: MealPlanMode,
  meals: readonly MealSkeletonResult[]
): number | null {
  if (mode !== "expiring_first") return null;

  const priorityNames = items
    .map((item) => ({ item, daysLeft: daysUntil(item.expirationDate, now) }))
    .filter(({ daysLeft, item }) => daysLeft >= 0 && (item.opened || daysLeft <= 7))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 15)
    .map(({ item }) => item.name.toLowerCase().trim());

  if (priorityNames.length === 0) return null;

  const usedKeyIngredients = new Set(
    meals.flatMap((m) => m.keyIngredients.map((k) => k.toLowerCase().trim()))
  );

  const usedCount = priorityNames.filter((name) =>
    Array.from(usedKeyIngredients).some((used) => used.includes(name) || name.includes(used))
  ).length;

  return usedCount / priorityNames.length;
}

// ---------------------------------------------------------------------------------
// Phase 1 — one call producing the whole skeleton.
// ---------------------------------------------------------------------------------

async function generateSkeleton(
  items: readonly PantryItem[],
  config: GenerationConfig,
  now: Date,
  nonce: string
): Promise<{ meals: MealSkeletonResult[]; usage: TokenUsage }> {
  const model = getModelForHousehold({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
  });

  const hardConstraints: HardConstraints = {
    allergies: config.allergies,
    dietaryRestrictions: config.dietaryRestrictions,
    servings: config.servings,
  };

  const expiringCount = items.filter((item) => {
    const daysLeft = daysUntil(item.expirationDate, now);
    return daysLeft >= 0 && daysLeft <= 7;
  }).length;

  const pantryBlockBody = renderInventoryBlock(items, now, {
    includeExpired: config.includeExpired,
    mode: config.mode,
  });

  const system = buildSystemPrompt({
    userTemplate: config.userTemplate,
    hardConstraints,
    templateVars: {
      days: config.dayCount,
      household: config.householdName,
      expiringSummary: `${expiringCount} item(s) expiring in the next 7 days`,
    },
    pantryBlockBody,
    nonce,
  });

  const requested = buildRequestedMealList(config.dayCount, config.slots);
  const baseUserMessage = `Generate meals for exactly these day/slot combinations, no more and no fewer:\n${formatRequestedMealList(requested)}`;

  const skeleton =
    fixtureSkeletonResponse() ??
    (await callWithFailurePolicy((nudge) =>
      llmDeps.generateObject({
        model,
        schema: PlanSkeletonSchema,
        system,
        messages: [
          { role: "user", content: nudge ? `${baseUserMessage}\n\n${nudge}` : baseUserMessage },
        ],
        abortSignal: AbortSignal.timeout(PHASE1_TIMEOUT_MS),
        maxOutputTokens: PHASE1_MAX_OUTPUT_TOKENS,
      })
    ));

  const meals: PlanSkeletonMeal[] = skeleton.object.meals;

  const ordered = meals
    .map((m) => ({
      dayIndex: m.dayIndex,
      slot: m.slot,
      sortOrder: slotSortIndex(m.slot),
      title: m.title,
      summary: m.summary,
      servings: m.servings,
      keyIngredients: m.keyIngredients,
    }))
    .sort((a, b) =>
      a.dayIndex !== b.dayIndex ? a.dayIndex - b.dayIndex : a.sortOrder - b.sortOrder
    );

  return { meals: ordered, usage: usageFromResult(skeleton.usage) };
}

// ---------------------------------------------------------------------------------
// Phase 2 — one call per meal, concurrency 4. Context is the meal title/summary/
// keyIngredients plus a small pantry digest — NOT the full inventory (plan §2.2).
// ---------------------------------------------------------------------------------

function buildPhase2SystemPrompt(
  meal: MealSkeletonResult,
  items: readonly PantryItem[],
  now: Date,
  config: GenerationConfig,
  nonce: string
): string {
  const hardConstraints: HardConstraints = {
    allergies: config.allergies,
    dietaryRestrictions: config.dietaryRestrictions,
    servings: meal.servings,
  };

  const digestBody = renderInventoryBlock(items, now, {
    includeExpired: false,
    mode: "balanced",
    maxItems: PHASE2_DIGEST_MAX_ITEMS,
  });

  const sanitizedTitle = sanitizeItemField(meal.title, 120);
  const sanitizedSummary = sanitizeItemField(meal.summary, 300);
  const sanitizedKeyIngredients = meal.keyIngredients.map((k) => sanitizeItemField(k, 60));

  // A fixed, code-authored template (never user-edited) — no {{}} substitution needed
  // beyond {{PANTRY}}, which buildSystemPrompt fills from `pantryBlockBody`.
  const userTemplate = `Write the complete recipe detail for this specific meal:
Title: ${sanitizedTitle}
Summary: ${sanitizedSummary}
Key ingredients: ${sanitizedKeyIngredients.join(", ")}
Servings: ${meal.servings}

Reference pantry (for ingredient naming/context only — the recipe does not need to use everything listed):
{{PANTRY}}`;

  return buildSystemPrompt({
    userTemplate,
    hardConstraints,
    templateVars: {
      days: 1,
      household: config.householdName,
      expiringSummary: "n/a",
    },
    pantryBlockBody: digestBody,
    nonce,
  });
}

async function generateMealDetail(
  meal: MealSkeletonResult,
  items: readonly PantryItem[],
  now: Date,
  config: GenerationConfig,
  nonce: string
): Promise<MealDetailResult> {
  try {
    const model = getModelForHousehold({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
    });
    const system = buildPhase2SystemPrompt(meal, items, now, config, nonce);

    const result =
      fixtureDetailResponse(`${meal.dayIndex}:${meal.slot}`) ??
      (await callWithFailurePolicy((nudge) =>
        llmDeps.generateObject({
          model,
          schema: RecipeDetailSchema,
          system,
          messages: [
            {
              role: "user",
              content: nudge ? `Write the recipe now.\n\n${nudge}` : "Write the recipe now.",
            },
          ],
          abortSignal: AbortSignal.timeout(PHASE2_TIMEOUT_MS),
          maxOutputTokens: PHASE2_MAX_OUTPUT_TOKENS,
        })
      ));

    const detail = result.object;

    const occurrences: IngredientOccurrence[] = detail.ingredients.map((ing) => ({
      dayIndex: meal.dayIndex,
      mealId: "", // filled in by the caller once a real meal id exists
      mealTitle: meal.title,
      ingredient: ing,
    }));

    return {
      dayIndex: meal.dayIndex,
      slot: meal.slot,
      detailStatus: "ready",
      detailError: null,
      prepMinutes: detail.prepMinutes,
      cookMinutes: detail.cookMinutes,
      instructions: detail.steps,
      ingredients: reconcilePlan(occurrences, items).ingredients,
      usage: usageFromResult(result.usage),
    };
  } catch (error) {
    // A single bad recipe must never make the whole plan useless (plan §4.1) — mark
    // just this meal failed, with a safe fixed message, and let the plan reach `ready`.
    const code = error instanceof GenerationFailure ? error.code : "unparseable_output";
    return {
      dayIndex: meal.dayIndex,
      slot: meal.slot,
      detailStatus: "failed",
      detailError: SAFE_ERROR_MESSAGES[code],
      prepMinutes: null,
      cookMinutes: null,
      instructions: [],
      ingredients: [],
      usage: ZERO_USAGE,
    };
  }
}

// ---------------------------------------------------------------------------------
// Concurrency-4 batch runner for phase 2, with cooperative cancellation between
// batches (plan §4.1).
// ---------------------------------------------------------------------------------

async function runPhase2(
  meals: readonly MealSkeletonResult[],
  items: readonly PantryItem[],
  now: Date,
  config: GenerationConfig,
  nonce: string,
  hooks: GenerationHooks
): Promise<boolean> {
  let progressDone = 0;
  const progressTotal = meals.length;
  let cancelled = false;

  for (let i = 0; i < meals.length; i += PHASE2_CONCURRENCY) {
    if (await hooks.isCancelled()) {
      cancelled = true;
      break;
    }

    const batch = meals.slice(i, i + PHASE2_CONCURRENCY);
    const results = await Promise.all(
      batch.map((meal) => generateMealDetail(meal, items, now, config, nonce))
    );

    for (let j = 0; j < batch.length; j++) {
      progressDone += 1;
      await hooks.onMealSettled({ ...batch[j]!, ...results[j]! }, progressDone, progressTotal);
    }
  }

  return cancelled;
}

// ---------------------------------------------------------------------------------
// Full two-phase orchestration — the pure(ish) seam under test. Takes only
// `{ items, config, now, householdId }` as data arguments (plan §8); `hooks` carries
// side effects out to the DB-aware caller.
// ---------------------------------------------------------------------------------

export async function generatePlanContent(
  args: { items: readonly PantryItem[]; config: GenerationConfig; now: Date; householdId: string },
  hooks: GenerationHooks
): Promise<GenerationOutcome> {
  const { items, config, now } = args;
  const nonce = crypto.randomUUID();

  const { meals: skeleton, usage: skeletonUsage } = await generateSkeleton(
    items,
    config,
    now,
    nonce
  );

  await hooks.onSkeletonReady(skeleton, skeletonUsage);

  const cancelled = await runPhase2(skeleton, items, now, config, nonce, hooks);

  const priorityCoverage = computePriorityCoverage(items, now, config.mode, skeleton);

  return { priorityCoverage, cancelled };
}

// ---------------------------------------------------------------------------------
// DB-aware wrapper — fetches inputs, wires real hooks, persists results. This is what
// routes fire-and-forget: `void runGeneration(id, slots).catch(...)`.
// ---------------------------------------------------------------------------------

function toPantryItem(row: typeof itemsTable.$inferSelect): PantryItem {
  return {
    id: row.id,
    name: row.name,
    quantity: Number(row.quantity),
    unit: row.unit,
    location: row.location,
    category: row.category,
    expirationDate: row.expirationDate,
    opened: row.opened,
  };
}

// ---------------------------------------------------------------------------------
// Internal-error diagnostics (plan §6.2 invariant: never log RAW PROVIDER error text,
// since a provider 401/429 body routinely echoes the submitted API key). That rule was
// over-applied into logging NOTHING at all, which made an internal bug (a DB
// constraint violation, a null deref, a Zod failure outside the LLM call path)
// indistinguishable from a provider outage — see `classifyRawError`/`GenerationFailure`
// for the (unaffected) provider-error path, which still never logs raw response text.
// This path is for the OTHER kind of error: anything that reaches runGeneration's
// outer catch as a plain, non-`GenerationFailure` exception. Those are internal bugs by
// definition (every provider-originated failure is already normalized into a
// `GenerationFailure` before it can escape `generateSkeleton`/`generateMealDetail`), so
// logging their name/message/stack is safe and necessary — but still redacted, in case
// a key ever ends up embedded in an internal error message by accident (e.g. a thrown
// `Error` that happens to interpolate a raw key in a message we didn't author here).
// ---------------------------------------------------------------------------------

/** Matches a provider API key by its known prefix; the char class after the prefix
 * greedily consumes the rest of the key (including embedded hyphens), so `sk-ant-...`
 * and `sk-or-v1-...` are fully redacted by the plain `sk-` alternative alone — the
 * longer prefixes are listed anyway for clarity, not because they're load-bearing. */
const SECRET_KEY_PATTERN = /(?:sk-ant-|sk-or-v1-|sk-|gsk_)[A-Za-z0-9_-]{4,}/g;

/** Redacts anything that looks like a provider API key from a diagnostic string.
 * Never a substitute for keeping raw provider response text out of logs entirely
 * (that invariant is unchanged) — this is a last-line safety net for internal error
 * text that was never supposed to contain a key in the first place. */
function redactSecrets(text: string): string {
  return text.replace(SECRET_KEY_PATTERN, "[redacted]");
}

/**
 * Logs diagnostics for an unexpected INTERNAL error (i.e. not a `GenerationFailure`,
 * which already carries only a safe fixed message). Logs the error's name, message,
 * and stack — through the redaction pass above — so an internal bug is actually
 * debuggable instead of silently becoming an indistinguishable `provider_unavailable`
 * (this is what let the `meal_plans_one_per_week_idx` collision below go unnoticed).
 */
function logInternalGenerationError(planId: string, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? null) : null;
  console.error(
    `[mealplan] internal generation error on plan ${planId}: ${redactSecrets(name)}: ${redactSecrets(message)}`,
    stack ? redactSecrets(stack) : ""
  );
}

async function markPlanFailed(
  planId: string,
  code: GenerationErrorCode,
  retryAfterSeconds: number | null = null,
  generationMs: number | null = null
): Promise<void> {
  await db
    .update(mealPlans)
    .set({
      status: "failed",
      errorCode: code,
      errorMessage: SAFE_ERROR_MESSAGES[code],
      errorRetryAfterSeconds: retryAfterSeconds,
      // Recorded on the failure path too, so a slow timeout is distinguishable from an
      // instant rejection (e.g. a bad key) when diagnosing after the fact.
      ...(generationMs !== null ? { generationMs } : {}),
      completedAt: new Date(),
    })
    .where(eq(mealPlans.id, planId));
}

export async function runGeneration(planId: string, slots: MealSlot[]): Promise<void> {
  const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, planId));
  if (!plan) return;

  const householdId = plan.householdId;
  // Wall-clock for the whole two-phase run, persisted to `meal_plans.generation_ms` on
  // both the ready and failed paths. Without this the column stays NULL forever, and
  // there is no signal for how long a real generation actually takes.
  const startedAtMs = Date.now();

  try {
    const [settings] = await db
      .select()
      .from(householdLlmSettings)
      .where(eq(householdLlmSettings.householdId, householdId));

    const storedSecret: EncryptedSecret | null =
      settings?.apiKeyCiphertext && settings.apiKeyIv && settings.apiKeyTag
        ? {
            ciphertext: settings.apiKeyCiphertext,
            iv: settings.apiKeyIv,
            tag: settings.apiKeyTag,
            kekVersion: settings.kekVersion,
          }
        : null;

    // provider/model are the FROZEN snapshot taken at plan-creation time (never the
    // live settings row — see the module doc and plan §11 "Regeneration"), so the key
    // resolution below is keyed on that snapshot's provider, not settings.provider.
    let apiKey: string;
    try {
      const resolved = await resolveLLMCredentials({
        householdId,
        provider: plan.providerSnapshot as HouseholdLLMProvider,
        model: plan.modelSnapshot,
        storedSecret,
      });
      if (!resolved.ok) {
        await markPlanFailed(planId, "invalid_api_key");
        return;
      }
      apiKey = resolved.credentials.apiKey;
    } catch (error) {
      if (error instanceof SecretDecryptionError) {
        await markPlanFailed(planId, "invalid_api_key");
        return;
      }
      throw error;
    }

    const [household] = await db
      .select({ name: households.name })
      .from(households)
      .where(eq(households.id, householdId));

    const itemRows = await db
      .select()
      .from(itemsTable)
      .where(eq(itemsTable.householdId, householdId));

    const pantryItems = itemRows.map(toPantryItem);

    const config: GenerationConfig = {
      provider: plan.providerSnapshot as HouseholdLLMProvider,
      model: plan.modelSnapshot,
      apiKey,
      dayCount: plan.dayCount,
      slots,
      mode: plan.mode as MealPlanMode,
      includeExpired: plan.includeExpired,
      servings: settings?.defaultServings ?? 2,
      allergies: settings?.allergies ?? [],
      dietaryRestrictions: settings?.dietaryRestrictions ?? [],
      userTemplate: plan.promptSnapshot,
      householdName: household?.name ?? "the household",
    };

    await db
      .update(mealPlans)
      .set({ status: "generating_skeleton", heartbeatAt: new Date() })
      .where(eq(mealPlans.id, planId));

    // dayId lookup filled in once onSkeletonReady persists the day rows.
    const dayIdByIndex = new Map<number, string>();
    const mealIdByKey = new Map<string, string>();

    const hooks: GenerationHooks = {
      async onSkeletonReady(meals, usage) {
        const dayIndexes = Array.from(new Set(meals.map((m) => m.dayIndex))).sort((a, b) => a - b);
        const startDate = plan.startDate; // YYYY-MM-DD, local-date string math (plan §3)

        const dayRows = dayIndexes.map((dayIndex) => ({
          householdId,
          planId,
          dayIndex,
          date: addDaysToLocalDateString(startDate, dayIndex),
        }));

        if (dayRows.length > 0) {
          const insertedDays = await db.insert(mealPlanDays).values(dayRows).returning();
          for (const row of insertedDays) dayIdByIndex.set(row.dayIndex, row.id);
        }

        if (meals.length > 0) {
          const mealRows = meals.map((m) => ({
            householdId,
            planId,
            dayId: dayIdByIndex.get(m.dayIndex)!,
            slot: m.slot,
            sortOrder: m.sortOrder,
            title: m.title,
            summary: m.summary,
            servings: m.servings,
            detailStatus: "pending" as const,
          }));
          const insertedMeals = await db.insert(mealPlanMeals).values(mealRows).returning();
          for (let i = 0; i < meals.length; i++) {
            const meal = meals[i]!;
            mealIdByKey.set(`${meal.dayIndex}:${meal.slot}`, insertedMeals[i]!.id);
          }
        }

        // Capture phase-1 usage now — accumulated with phase-2 usage below rather than
        // overwritten, so the final total reflects both phases (plan §4.5, §11 Q6).
        await db
          .update(mealPlans)
          .set({
            status: "generating_recipes",
            progressTotal: meals.length,
            progressDone: 0,
            inputTokens: sql`COALESCE(${mealPlans.inputTokens}, 0) + ${usage.inputTokens}`,
            outputTokens: sql`COALESCE(${mealPlans.outputTokens}, 0) + ${usage.outputTokens}`,
            heartbeatAt: new Date(),
          })
          .where(eq(mealPlans.id, planId));
      },

      async onMealSettled(meal, progressDone, progressTotal) {
        const mealId = mealIdByKey.get(`${meal.dayIndex}:${meal.slot}`);
        if (!mealId) return;

        await db
          .update(mealPlanMeals)
          .set({
            detailStatus: meal.detailStatus,
            detailError: meal.detailError,
            prepMinutes: meal.prepMinutes,
            cookMinutes: meal.cookMinutes,
            instructions: meal.instructions,
          })
          .where(eq(mealPlanMeals.id, mealId));

        if (meal.ingredients.length > 0) {
          await db.insert(mealPlanIngredients).values(
            meal.ingredients.map((ing, idx) => ({
              householdId,
              mealId,
              rawText: ing.rawText,
              nameNormalized: ing.nameNormalized,
              quantity: ing.quantity !== null ? String(ing.quantity) : null,
              unit: ing.unit,
              preparation: ing.preparation,
              optional: ing.optional,
              source: ing.source,
              matchedItemId: ing.matchedItemId,
              matchConfidence: ing.matchConfidence !== null ? String(ing.matchConfidence) : null,
              sortOrder: idx,
            }))
          );
        }

        await db
          .update(mealPlans)
          .set({
            progressDone,
            progressTotal,
            inputTokens: sql`COALESCE(${mealPlans.inputTokens}, 0) + ${meal.usage.inputTokens}`,
            outputTokens: sql`COALESCE(${mealPlans.outputTokens}, 0) + ${meal.usage.outputTokens}`,
            heartbeatAt: new Date(),
          })
          .where(eq(mealPlans.id, planId));
      },

      async isCancelled() {
        const [current] = await db
          .select({ status: mealPlans.status })
          .from(mealPlans)
          .where(eq(mealPlans.id, planId));
        return current?.status === "cancelled";
      },
    };

    const outcome = await generatePlanContent(
      { items: pantryItems, config, now: new Date(), householdId },
      hooks
    );

    if (outcome.cancelled) return; // status already 'cancelled'; leave it as-is

    // `meal_plans_one_per_week_idx` (UNIQUE on household_id, start_date WHERE status =
    // 'ready') allows only one 'ready' plan per household per week — see plan §3, §4.5
    // "Regeneration". A second successful generation for a week that already has a
    // 'ready' plan (e.g. the user regenerates the whole week, or two default-start-date
    // requests land on the same week) would otherwise hit that constraint as a raw
    // Postgres 23505 on the UPDATE below — a real bug reproduced live: plan
    // ed5040c9-ec87-4bcd-bcdc-c77873d1d5ee completed both meals successfully (both
    // `detail_status = 'ready'`) but its final status flip crashed here because
    // household 60d70674-b193-4961-a5eb-bcf5a95615bd already had a 'ready' plan
    // (93d6a144-c065-4eae-a655-df5efe4b076b) for the same `start_date`. Demote any such
    // sibling INSIDE the same transaction as this plan's own ready flip so the two
    // writes are atomic and the constraint is never violated: per §4.5 "Regeneration",
    // a plan is "never mutated in place; a new row, old plan stays queryable" — so the
    // NEWEST successful generation for a week is what "ready" should mean going
    // forward, while the superseded plan's rows remain fully intact and queryable
    // under a different status, exactly like the existing `/cancel` route's
    // `{status: 'cancelled', completedAt}` write.
    await db.transaction(async (tx) => {
      await tx
        .update(mealPlans)
        .set({ status: "cancelled", completedAt: new Date() })
        .where(
          and(
            eq(mealPlans.householdId, householdId),
            eq(mealPlans.startDate, plan.startDate),
            eq(mealPlans.status, "ready"),
            ne(mealPlans.id, planId)
          )
        );

      await tx
        .update(mealPlans)
        .set({
          status: "ready",
          priorityCoverage:
            outcome.priorityCoverage !== null ? String(outcome.priorityCoverage) : null,
          generationMs: Date.now() - startedAtMs,
          completedAt: new Date(),
        })
        .where(eq(mealPlans.id, planId));
    });
  } catch (error) {
    // Every provider-originated failure is already normalized into a `GenerationFailure`
    // before it can escape phase 1/phase 2 (see `callWithProviderRetry`) — anything else
    // reaching this catch is an internal bug (DB error, null deref, an unhandled Zod
    // failure, etc.), never a provider response, so it must never masquerade as
    // `provider_unavailable` (plan §6.2's "never log/return raw provider text" doesn't
    // mean "never log anything" — see `logInternalGenerationError`).
    const code = error instanceof GenerationFailure ? error.code : "internal_error";
    const retryAfterSeconds = error instanceof GenerationFailure ? error.retryAfterSeconds : null;
    if (!(error instanceof GenerationFailure)) {
      logInternalGenerationError(planId, error);
    }
    await markPlanFailed(planId, code, retryAfterSeconds, Date.now() - startedAtMs);
  }
}

/** Adds `n` days to a `YYYY-MM-DD` local-date string using pure string/UTC-epoch-day math — never `Date.toISOString()`, which can shift a day at timezone boundaries (plan §3). */
export function addDaysToLocalDateString(dateStr: string, n: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) throw new Error(`Invalid local date string: ${dateStr}`);
  const [, y, m, d] = match;
  const epochMs = Date.UTC(Number(y), Number(m) - 1, Number(d)) + n * 86_400_000;
  const dt = new Date(epochMs);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------------
// Single-meal regeneration (plan §11 Q7) — re-runs phase 2 for one existing meal.
// ---------------------------------------------------------------------------------

export async function regenerateMeal(planId: string, mealId: string): Promise<void> {
  const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, planId));
  if (!plan) return;
  const householdId = plan.householdId;

  const [mealRow] = await db
    .select()
    .from(mealPlanMeals)
    .where(and(eq(mealPlanMeals.id, mealId), eq(mealPlanMeals.planId, planId)));
  if (!mealRow) return;

  const [dayRow] = await db.select().from(mealPlanDays).where(eq(mealPlanDays.id, mealRow.dayId));
  if (!dayRow) return;

  try {
    const [settings] = await db
      .select()
      .from(householdLlmSettings)
      .where(eq(householdLlmSettings.householdId, householdId));

    const storedSecret: EncryptedSecret | null =
      settings?.apiKeyCiphertext && settings.apiKeyIv && settings.apiKeyTag
        ? {
            ciphertext: settings.apiKeyCiphertext,
            iv: settings.apiKeyIv,
            tag: settings.apiKeyTag,
            kekVersion: settings.kekVersion,
          }
        : null;

    // Same resolution as runGeneration: provider/model come from the plan's frozen
    // snapshot, key resolution falls back to the container-wide env key (plan §4.5).
    let apiKey: string;
    try {
      const resolved = await resolveLLMCredentials({
        householdId,
        provider: plan.providerSnapshot as HouseholdLLMProvider,
        model: plan.modelSnapshot,
        storedSecret,
      });
      if (!resolved.ok) {
        await db
          .update(mealPlanMeals)
          .set({
            detailStatus: "failed",
            detailError: SAFE_ERROR_MESSAGES.invalid_api_key,
          })
          .where(eq(mealPlanMeals.id, mealId));
        return;
      }
      apiKey = resolved.credentials.apiKey;
    } catch (error) {
      if (error instanceof SecretDecryptionError) {
        await db
          .update(mealPlanMeals)
          .set({
            detailStatus: "failed",
            detailError: SAFE_ERROR_MESSAGES.invalid_api_key,
          })
          .where(eq(mealPlanMeals.id, mealId));
        return;
      }
      throw error;
    }

    const [household] = await db
      .select({ name: households.name })
      .from(households)
      .where(eq(households.id, householdId));

    const itemRows = await db
      .select()
      .from(itemsTable)
      .where(eq(itemsTable.householdId, householdId));
    const pantryItems = itemRows.map(toPantryItem);

    const config: GenerationConfig = {
      provider: plan.providerSnapshot as HouseholdLLMProvider,
      model: plan.modelSnapshot,
      apiKey,
      dayCount: plan.dayCount,
      slots: [],
      mode: plan.mode as MealPlanMode,
      includeExpired: plan.includeExpired,
      servings: settings?.defaultServings ?? 2,
      allergies: settings?.allergies ?? [],
      dietaryRestrictions: settings?.dietaryRestrictions ?? [],
      userTemplate: plan.promptSnapshot,
      householdName: household?.name ?? "the household",
    };

    // The original keyIngredients aren't persisted separately post-skeleton; re-derive
    // a minimal skeleton context from the stored title/summary. keyIngredients falls
    // back to an empty list — the model still has title/summary to work from.
    const meal: MealSkeletonResult = {
      dayIndex: dayRow.dayIndex,
      slot: mealRow.slot as MealSlot,
      sortOrder: slotSortIndex(mealRow.slot as MealSlot),
      title: mealRow.title,
      summary: mealRow.summary ?? "",
      servings: mealRow.servings ?? settings?.defaultServings ?? 2,
      keyIngredients: [],
    };

    const nonce = crypto.randomUUID();
    const detail = await generateMealDetail(meal, pantryItems, new Date(), config, nonce);

    await db
      .update(mealPlanMeals)
      .set({
        detailStatus: detail.detailStatus,
        detailError: detail.detailError,
        prepMinutes: detail.prepMinutes,
        cookMinutes: detail.cookMinutes,
        instructions: detail.instructions,
      })
      .where(eq(mealPlanMeals.id, mealId));

    await db.delete(mealPlanIngredients).where(eq(mealPlanIngredients.mealId, mealId));
    if (detail.ingredients.length > 0) {
      await db.insert(mealPlanIngredients).values(
        detail.ingredients.map((ing, idx) => ({
          householdId,
          mealId,
          rawText: ing.rawText,
          nameNormalized: ing.nameNormalized,
          quantity: ing.quantity !== null ? String(ing.quantity) : null,
          unit: ing.unit,
          preparation: ing.preparation,
          optional: ing.optional,
          source: ing.source,
          matchedItemId: ing.matchedItemId,
          matchConfidence: ing.matchConfidence !== null ? String(ing.matchConfidence) : null,
          sortOrder: idx,
        }))
      );
    }

    // Regeneration is additional spend on top of the original generation — accumulate
    // onto the plan's existing totals, never overwrite them (plan §4.5, §11 Q6).
    await db
      .update(mealPlans)
      .set({
        inputTokens: sql`COALESCE(${mealPlans.inputTokens}, 0) + ${detail.usage.inputTokens}`,
        outputTokens: sql`COALESCE(${mealPlans.outputTokens}, 0) + ${detail.usage.outputTokens}`,
        heartbeatAt: new Date(),
      })
      .where(eq(mealPlans.id, planId));
  } catch {
    await db
      .update(mealPlanMeals)
      .set({ detailStatus: "failed", detailError: SAFE_ERROR_MESSAGES.provider_unavailable })
      .where(eq(mealPlanMeals.id, mealId));
  }
}

// ---------------------------------------------------------------------------------
// Crash sweep (plan §4.1) — any `generating_*` row whose heartbeat has gone stale
// (worker died with the process, since there is no queue) is failed with
// `error_code = 'interrupted'`.
// ---------------------------------------------------------------------------------

const STALE_HEARTBEAT_MS = 10 * 60 * 1000;
const GENERATING_STATUSES = ["queued", "generating_skeleton", "generating_recipes"] as const;

export async function sweepStalePlans(now: Date = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_HEARTBEAT_MS);

  // `queued` rows may never have had a heartbeat yet (the worker hasn't started), so
  // staleness falls back to `created_at` in that case — otherwise a crash between
  // insert and the worker's first heartbeat write would never be swept.
  const rows = await db
    .select()
    .from(mealPlans)
    .where(inArray(mealPlans.status, GENERATING_STATUSES));

  const staleIds = rows
    .filter((row) => (row.heartbeatAt ?? row.createdAt).getTime() < staleBefore.getTime())
    .map((row) => row.id);

  if (staleIds.length === 0) return 0;

  // Both writes happen in the same transaction so a plan can never be observed as
  // `failed` with a meal still `pending` — `onSkeletonReady` inserts every meal row as
  // `pending` before phase 2 runs, and if the process dies mid-`generating_recipes`
  // those rows would otherwise stay `pending` forever. The client's
  // `planNeedsPolling` keeps polling `GET /:id` every 2s while ANY meal is `pending`,
  // independent of the plan's own status, so an orphaned pending meal is an infinite
  // client-side poll loop, not just stale data.
  await db.transaction(async (tx) => {
    await tx
      .update(mealPlans)
      .set({
        status: "failed",
        errorCode: "interrupted",
        errorMessage: SAFE_ERROR_MESSAGES.interrupted,
        completedAt: now,
      })
      .where(inArray(mealPlans.id, staleIds));

    await tx
      .update(mealPlanMeals)
      .set({
        detailStatus: "failed",
        detailError: "Generation was interrupted",
      })
      .where(
        and(inArray(mealPlanMeals.planId, staleIds), eq(mealPlanMeals.detailStatus, "pending"))
      );
  });

  return staleIds.length;
}
