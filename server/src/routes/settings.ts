import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { APICallError } from "ai";
import {
  updateLlmSettingsSchema,
  testLlmSettingsSchema,
  llmProviderSchema,
} from "@pantrymaid/shared/schemas";
import type {
  UpdateLlmSettingsInput,
  TestLlmSettingsInput,
  LlmModelsReason,
} from "@pantrymaid/shared/schemas";
import { authMiddleware, getUser } from "../middleware/auth";
import { checkRateLimit } from "../middleware/ratelimit";
import { db } from "../lib/db";
import { householdLlmSettings } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  encryptSecret,
  lastFour,
  fingerprintSecret,
  KekConfigError,
  SecretDecryptionError,
  type EncryptedSecret,
} from "../lib/crypto";
import {
  _deps,
  getModelForHousehold,
  resolveLLMConfigPreview,
  resolveLLMCredentials,
  resolveEnvDefaults,
  InvalidModelIdError,
  UnsupportedHouseholdProviderError,
  type HouseholdLLMProvider,
} from "../lib/llm";
import { HOUSEHOLD_VISION_DEFAULT_MODELS } from "../lib/openai";

type LlmSettingsRow = typeof householdLlmSettings.$inferSelect;

/** Mirrors `resolveEnvDefaults()` but for the vision model — what receipt OCR would
 * fall back to if this household never configures its own `visionModel` (see
 * lib/openai.ts's resolveVisionModel precedence chain, which this must stay in sync
 * with). Never reads a household row; env/default-map only. */
function resolveVisionEnvDefault(envProvider: HouseholdLLMProvider | null): string | null {
  if (process.env.LLM_VISION_MODEL) return process.env.LLM_VISION_MODEL;
  if (!envProvider) return null;
  return HOUSEHOLD_VISION_DEFAULT_MODELS[envProvider] ?? null;
}

// Explicit field allow-list — NEVER spread a settings row into a response. The
// ciphertext/iv/tag/fingerprint columns must never leave this module (plan §6.2).
//
// keyConfigured/keySource reflect EITHER key source (household or the container-wide
// env default, plan §4.5) via resolveLLMConfigPreview — a household relying purely on
// the operator's env key must still see keyConfigured: true so the frontend shows the
// generate button. keyLast4 stays household-only: it is read straight off the row and
// is null whenever the row has no stored key, even if keySource is "env" — the env
// key is the operator's, not the household's, and nothing about it (value, last4,
// fingerprint) is ever derived or returned here.
function serializeLlmSettings(row: LlmSettingsRow | undefined) {
  const provider = (row?.provider as HouseholdLLMProvider | undefined) ?? null;
  const model = row?.model ?? null;
  const preview = resolveLLMConfigPreview({
    provider,
    model,
    hasHouseholdKey: Boolean(row?.apiKeyCiphertext),
  });
  const envDefaults = resolveEnvDefaults();
  return {
    provider,
    model,
    visionModel: row?.visionModel ?? null,
    keyConfigured: preview !== null,
    keySource: preview?.source ?? null,
    keyLast4: row?.apiKeyLast4 ?? null,
    defaultServings: row?.defaultServings ?? 2,
    allergies: row?.allergies ?? [],
    dietaryRestrictions: row?.dietaryRestrictions ?? [],
    weekStartDay: row?.weekStartDay ?? 1,
    timezone: row?.timezone ?? "America/New_York",
    envDefaults: {
      ...envDefaults,
      visionModel: resolveVisionEnvDefault(envDefaults.provider),
    },
  };
}

// Returns the stored ciphertext/iv/tag as a decryptable payload, or null if no key
// (or an incompletely-written key) is on the row.
function getStoredSecret(row: LlmSettingsRow): EncryptedSecret | null {
  if (!row.apiKeyCiphertext || !row.apiKeyIv || !row.apiKeyTag) return null;
  return {
    ciphertext: row.apiKeyCiphertext,
    iv: row.apiKeyIv,
    tag: row.apiKeyTag,
    kekVersion: row.kekVersion,
  };
}

const TestProbeSchema = z.object({
  ready: z.boolean().describe("Always true — confirms the model responded with valid JSON."),
});

type ProviderTestError = "invalid_key" | "provider_unavailable" | "rate_limited" | "timeout";

// The test probe makes a REAL outbound call with a caller-supplied API key and a 15s
// abort window — with no limiter, a burst of concurrent requests is (a) an
// availability DoS against this single-process Bun server (each holds a connection
// for up to 15s) and (b) an unmetered oracle for validating stolen third-party API
// keys, laundered through this server's IP. Keyed on householdId (never a spoofable
// request header — the same rule as the generation limiter, plan §6.5) and kept tight
// and independent of the 5/hour generation budget, since this is a cheap probe, not a
// billed generation.
const TEST_PROBE_LIMIT = 5;
const TEST_PROBE_WINDOW_MS = 60 * 1000; // 1 minute

// Provider errors are the sharpest leak in this feature: OpenAI/OpenRouter 401 bodies
// routinely echo the submitted key or an Authorization fragment. Every provider call
// is caught here and mapped to a fixed enum — nothing raw ever reaches the client or
// app.onError (plan §6.2).
function classifyProviderError(error: unknown): ProviderTestError {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) return "invalid_key";
    if (error.statusCode === 429) return "rate_limited";
    return "provider_unavailable";
  }
  return "provider_unavailable";
}

// ---------------------------------------------------------------------------------
// GET /settings/llm/models — a LIVE model catalogue fetched from the provider's own
// API, replacing a hardcoded list that goes stale every time a provider ships a new
// model (plan §5.6). Same shape of protections as the /llm/test probe above: rate
// limited on householdId (never a header, plan §6.5), fixed base-URL map (plan §6.4 —
// no user-supplied URL ever reaches `fetch`), and provider failures mapped to a fixed
// enum so nothing raw (including key material) ever reaches the client.
// ---------------------------------------------------------------------------------

const MODELS_LIST_LIMIT = 20;
const MODELS_LIST_WINDOW_MS = 60 * 1000; // 1 minute

// Model catalogues change rarely; caching per (householdId, provider) avoids an
// outbound authenticated call on every keystroke-adjacent re-render/provider-switch
// within this window. Deliberately in-process only (like RateLimiter above) — a stale
// cache after a restart just means one extra upstream call, not a correctness bug.
const MODELS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface ProviderModelsResult {
  models: string[];
  reason: LlmModelsReason | null;
}

interface ModelsCacheEntry {
  expiresAt: number;
  result: ProviderModelsResult;
}

const modelsCache = new Map<string, ModelsCacheEntry>();

// Fixed, hardcoded provider catalogue endpoints — reachable ONLY via the `?provider=`
// enum (validated by `llmProviderSchema`), never from any user-supplied string. Same
// SSRF rule as `HOUSEHOLD_PROVIDER_BASE_URLS` in lib/llm.ts (plan §6.4).
const MODEL_CATALOG_URLS: Readonly<Record<HouseholdLLMProvider, string>> = {
  openai: "https://api.openai.com/v1/models",
  anthropic: "https://api.anthropic.com/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
};

// OpenAI's /v1/models mixes chat-completion models in with audio/image/embedding/
// moderation/legacy-completion models that would silently break meal-plan generation
// if suggested. Only patterns we're CONFIDENT aren't chat-completion are excluded —
// anything ambiguous (new model families, reasoning models, etc.) is kept, per the
// "when unsure, include it" directive: hiding a valid model is worse than one bad
// suggestion the user simply won't pick.
const OPENAI_NON_CHAT_MODEL_PATTERN =
  /^(whisper|tts|dall-e|text-embedding|text-moderation|omni-moderation|davinci|babbage|curie|ada)(-|$)/i;

function classifyModelsFetchError(error: unknown): LlmModelsReason {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "timeout";
  }
  return "provider_unavailable";
}

function classifyModelsStatusError(status: number): LlmModelsReason {
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return "rate_limited";
  return "provider_unavailable";
}

function extractModelIds(provider: HouseholdLLMProvider, body: unknown): string[] {
  if (
    !body ||
    typeof body !== "object" ||
    !("data" in body) ||
    !Array.isArray((body as { data: unknown }).data)
  ) {
    return [];
  }
  const rawEntries = (body as { data: unknown[] }).data;
  const entries = rawEntries.filter(
    (m): m is { id: string; created?: unknown; created_at?: unknown } =>
      typeof m === "object" && m !== null && typeof (m as { id?: unknown }).id === "string"
  );

  const withTimestamp = entries.map((m) => {
    const created =
      typeof m.created === "number"
        ? m.created * 1000
        : typeof m.created_at === "string"
          ? Date.parse(m.created_at)
          : 0;
    return { id: m.id, created: Number.isFinite(created) ? created : 0 };
  });

  const filtered =
    provider === "openai"
      ? withTimestamp.filter((m) => !OPENAI_NON_CHAT_MODEL_PATTERN.test(m.id))
      : withTimestamp;

  // Newest/most-relevant first when the provider exposes a created timestamp; ids
  // without one sort after ids that have one, preserving upstream order among ties.
  return filtered.sort((a, b) => b.created - a.created).map((m) => m.id);
}

async function fetchProviderModels(
  provider: HouseholdLLMProvider,
  apiKey: string | null
): Promise<ProviderModelsResult> {
  // OpenRouter's catalogue endpoint needs no auth (plan requirement); openai/anthropic
  // both require a real key, so no key means no point attempting the call.
  if (provider !== "openrouter" && !apiKey) {
    return { models: [], reason: "no_api_key" };
  }

  const headers: Record<string, string> = {};
  if (provider === "openai") {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (provider === "anthropic") {
    headers["x-api-key"] = apiKey as string;
    headers["anthropic-version"] = "2023-06-01";
  }

  let response: Response;
  try {
    response = await fetch(MODEL_CATALOG_URLS[provider], {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const reason = classifyModelsFetchError(error);
    console.error(`Model catalogue fetch failed for ${provider}:`, reason);
    return { models: [], reason };
  }

  if (!response.ok) {
    const reason = classifyModelsStatusError(response.status);
    console.error(`Model catalogue fetch for ${provider} returned ${response.status}`);
    return { models: [], reason };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error(`Model catalogue response for ${provider} was not valid JSON`);
    return { models: [], reason: "provider_unavailable" };
  }

  return { models: extractModelIds(provider, body), reason: null };
}

// `KekConfigError.reason` (crypto.ts) distinguishes "MEAL_PLAN_KEK not set at all"
// from "set but the wrong length" — these used to collapse into one identical 500
// ("Server is not configured to store API keys"), which is exactly what turned a
// single missing-env-var mistake into hours of back-and-forth: an operator who set a
// MALFORMED key hit the same generic wall as one who'd set nothing at all, with the
// real reason visible only in a server log that's awkward to reach from some
// deployment targets. This is the operator's own container configuration, not user
// data — but the message stays factual and short, and NEVER echoes the KEK value, any
// part of it, or the byte count (that detail stays server-log-only, printed by
// crypto.ts's decodeBase64Kek).
function respondKekConfigError(c: Context, error: KekConfigError) {
  console.error(`MEAL_PLAN_KEK misconfigured (${error.reason}):`, error.message);
  const message =
    error.reason === "absent"
      ? "Server is not configured to store per-household API keys (MEAL_PLAN_KEK is not set). " +
        "This is an operator configuration issue, not something you can fix here — ask your " +
        "administrator to set MEAL_PLAN_KEK."
      : "Server's per-household API key storage is misconfigured (MEAL_PLAN_KEK is set but " +
        "invalid). This is an operator configuration issue — ask your administrator to check " +
        "the server log for the exact problem.";
  return c.json({ success: false, error: message }, 500);
}

const settings = new Hono();
settings.use("*", authMiddleware);

// GET /settings/llm — never returns the raw API key.
settings.get("/llm", async (c) => {
  try {
    const user = getUser(c);
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const [row] = await db
      .select()
      .from(householdLlmSettings)
      .where(eq(householdLlmSettings.householdId, user.householdId));
    return c.json({ success: true, data: serializeLlmSettings(row) });
  } catch (error) {
    console.error("Error fetching LLM settings:", error);
    return c.json({ success: false, error: "Failed to fetch LLM settings" }, 500);
  }
});

// GET /settings/llm/models?provider=<provider> — live suggestions only. The model
// field itself stays free text everywhere else in this file; nothing here narrows what
// a household is allowed to save.
settings.get(
  "/llm/models",
  zValidator("query", z.object({ provider: llmProviderSchema })),
  async (c) => {
    try {
      const user = getUser(c);
      if (!user.householdId) {
        return c.json({ success: false, error: "User must belong to a household" }, 403);
      }

      if (
        !checkRateLimit(`llm-models:${user.householdId}`, MODELS_LIST_LIMIT, MODELS_LIST_WINDOW_MS)
      ) {
        return c.json(
          { success: false, error: "Too many model list requests — try again in a minute" },
          429
        );
      }

      const { provider } = c.req.valid("query") as { provider: HouseholdLLMProvider };

      const cacheKey = `${user.householdId}:${provider}`;
      const cached = modelsCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return c.json({ success: true, data: { provider, ...cached.result } });
      }

      const [existing] = await db
        .select()
        .from(householdLlmSettings)
        .where(eq(householdLlmSettings.householdId, user.householdId));

      // Only treat the household's stored ciphertext as usable for THIS provider when
      // it was actually saved under this same provider — resolveLLMConfigPreview
      // assumes hasHouseholdKey/provider are consistent with each other, and passing a
      // key encrypted for one provider through as another provider's credential would
      // mean sending (say) the household's OpenAI key to Anthropic's API.
      const existingProvider = existing?.provider as HouseholdLLMProvider | undefined;
      const storedSecret =
        existing && existingProvider === provider ? getStoredSecret(existing) : null;

      let apiKey: string | null = null;
      try {
        const resolved = await resolveLLMCredentials({
          householdId: user.householdId,
          provider,
          model: existing?.model ?? null,
          storedSecret,
        });
        if (resolved.ok) apiKey = resolved.credentials.apiKey;
      } catch (error) {
        if (error instanceof SecretDecryptionError) {
          const result: ProviderModelsResult = { models: [], reason: "invalid_key" };
          modelsCache.set(cacheKey, { expiresAt: Date.now() + MODELS_CACHE_TTL_MS, result });
          return c.json({ success: true, data: { provider, ...result } });
        }
        throw error;
      }

      const result = await fetchProviderModels(provider, apiKey);
      modelsCache.set(cacheKey, { expiresAt: Date.now() + MODELS_CACHE_TTL_MS, result });

      return c.json({ success: true, data: { provider, ...result } });
    } catch (error) {
      if (error instanceof KekConfigError) {
        return respondKekConfigError(c, error);
      }
      console.error("Error fetching LLM model catalogue:", error);
      return c.json({ success: false, error: "Failed to fetch model list" }, 500);
    }
  }
);

// PUT /settings/llm — apiKey omitted keeps the existing key; apiKey: null clears it;
// apiKey: "<string>" replaces it. See updateLlmSettingsSchema's comment (packages/shared)
// for the null-vs-undefined precedent this follows.
settings.put("/llm", zValidator("json", updateLlmSettingsSchema), async (c) => {
  try {
    const user = getUser(c);
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }
    const data = c.req.valid("json") as UpdateLlmSettingsInput;

    const [existing] = await db
      .select()
      .from(householdLlmSettings)
      .where(eq(householdLlmSettings.householdId, user.householdId));

    // No precondition on key presence here: saving preferences (provider/model,
    // allergies, dietary restrictions, servings, week start, timezone) must always be
    // possible, with or without a configured key — generation already fails cleanly via
    // the no_api_key path, and the frontend renders an AiSetupPrompt when
    // keyConfigured is false (plan §5.7). Requiring a key here would make
    // safety-critical fields like allergies unsavable whenever no key is configured,
    // including right after using "Remove key".
    let apiKeyCiphertext: string | null;
    let apiKeyIv: string | null;
    let apiKeyTag: string | null;
    let apiKeyLast4: string | null;
    let apiKeyFingerprint: string | null;
    let kekVersion: number;

    if (data.apiKey === undefined) {
      // Omitted — keep whatever is already stored, unchanged.
      apiKeyCiphertext = existing?.apiKeyCiphertext ?? null;
      apiKeyIv = existing?.apiKeyIv ?? null;
      apiKeyTag = existing?.apiKeyTag ?? null;
      apiKeyLast4 = existing?.apiKeyLast4 ?? null;
      apiKeyFingerprint = existing?.apiKeyFingerprint ?? null;
      kekVersion = existing?.kekVersion ?? 1;
    } else if (data.apiKey === null) {
      // Explicit clear — wipe every column that could reconstruct or fingerprint the
      // old key. kek_version resets to the schema default since there is no ciphertext
      // left for it to describe.
      apiKeyCiphertext = null;
      apiKeyIv = null;
      apiKeyTag = null;
      apiKeyLast4 = null;
      apiKeyFingerprint = null;
      kekVersion = 1;
    } else {
      // Replace — encrypt the new key under the current KEK.
      const encrypted = await encryptSecret(data.apiKey, user.householdId);
      apiKeyCiphertext = encrypted.ciphertext;
      apiKeyIv = encrypted.iv;
      apiKeyTag = encrypted.tag;
      apiKeyLast4 = lastFour(data.apiKey);
      apiKeyFingerprint = await fingerprintSecret(data.apiKey);
      kekVersion = encrypted.kekVersion;
    }

    // Same omitted/null precedent as apiKey (see the block above): omitted keeps
    // whatever is already stored; explicit null clears back to the env/default-map
    // fallback in resolveVisionModel.
    const visionModel =
      data.visionModel === undefined ? (existing?.visionModel ?? null) : data.visionModel;

    const values = {
      householdId: user.householdId,
      provider: data.provider,
      model: data.model,
      visionModel,
      apiKeyCiphertext,
      apiKeyIv,
      apiKeyTag,
      apiKeyLast4,
      apiKeyFingerprint,
      kekVersion,
      defaultServings: data.defaultServings ?? existing?.defaultServings ?? 2,
      allergies: data.allergies ?? existing?.allergies ?? [],
      dietaryRestrictions: data.dietaryRestrictions ?? existing?.dietaryRestrictions ?? [],
      weekStartDay: data.weekStartDay ?? existing?.weekStartDay ?? 1,
      timezone: data.timezone ?? existing?.timezone ?? "America/New_York",
      updatedBy: user.id,
      updatedAt: new Date(),
    };

    const [saved] = await db
      .insert(householdLlmSettings)
      .values(values)
      .onConflictDoUpdate({
        target: householdLlmSettings.householdId,
        set: values,
      })
      .returning();

    return c.json({ success: true, data: serializeLlmSettings(saved) });
  } catch (error) {
    if (error instanceof KekConfigError) {
      return respondKekConfigError(c, error);
    }
    console.error("Error updating LLM settings:", error);
    return c.json({ success: false, error: "Failed to update LLM settings" }, 500);
  }
});

// POST /settings/llm/test — tiny probe call. Works on an unsaved key (all body
// fields optional) so users can validate before committing, per plan §5.6.
settings.post("/llm/test", zValidator("json", testLlmSettingsSchema), async (c) => {
  const started = Date.now();
  try {
    const user = getUser(c);
    if (!user.householdId) {
      return c.json({ success: false, error: "User must belong to a household" }, 403);
    }

    if (!checkRateLimit(`llm-test:${user.householdId}`, TEST_PROBE_LIMIT, TEST_PROBE_WINDOW_MS)) {
      return c.json(
        { success: false, error: "Too many test requests — try again in a minute" },
        429
      );
    }

    const body = c.req.valid("json") as TestLlmSettingsInput;

    let apiKey = body.apiKey;
    let provider: HouseholdLLMProvider | undefined = body.provider;
    let model = body.model;

    if (!apiKey) {
      // No explicit key in the request — test the household's saved key, falling back
      // to the container-wide env key for the resolved provider (plan §4.5), same
      // resolution order as real generation.
      const [existing] = await db
        .select()
        .from(householdLlmSettings)
        .where(eq(householdLlmSettings.householdId, user.householdId));

      const storedSecret = existing ? getStoredSecret(existing) : null;

      let resolved;
      try {
        resolved = await resolveLLMCredentials({
          householdId: user.householdId,
          provider: provider ?? (existing?.provider as HouseholdLLMProvider | undefined) ?? null,
          model: model ?? existing?.model ?? null,
          storedSecret,
        });
      } catch (error) {
        if (error instanceof SecretDecryptionError) {
          return c.json({
            success: true,
            data: { ok: false, latencyMs: Date.now() - started, error: "invalid_key" },
          });
        }
        throw error;
      }

      if (!resolved.ok) {
        return c.json(
          { success: false, error: "No API key to test — provide one or save settings first" },
          400
        );
      }

      apiKey = resolved.credentials.apiKey;
      provider = resolved.credentials.provider;
      model = resolved.credentials.model;
    } else if (!provider || !model) {
      // An explicit key was given but provider/model were not — fall back to the
      // household's saved preferences (unchanged from prior behavior for this
      // partial-override case; no env involvement since a key was already supplied).
      const [existing] = await db
        .select()
        .from(householdLlmSettings)
        .where(eq(householdLlmSettings.householdId, user.householdId));

      provider = provider ?? (existing?.provider as HouseholdLLMProvider | undefined);
      model = model ?? existing?.model;
    }

    if (!provider || !model) {
      return c.json({ success: false, error: "provider and model are required to test" }, 400);
    }

    try {
      const modelHandle = getModelForHousehold({ provider, model, apiKey });
      await _deps.generateObject({
        model: modelHandle,
        schema: TestProbeSchema,
        system: "Respond only with the requested JSON.",
        messages: [{ role: "user", content: "Reply with ready: true." }],
        abortSignal: AbortSignal.timeout(15_000),
        // The probe's whole response is `{ready: true}` — ~5 tokens. Bounding this
        // caps what a degenerate/looping completion can bill the household for on a
        // call that isn't even gated by the generation budget (plan §4.5).
        maxOutputTokens: 20,
      });
      return c.json({ success: true, data: { ok: true, latencyMs: Date.now() - started } });
    } catch (error) {
      if (
        error instanceof InvalidModelIdError ||
        error instanceof UnsupportedHouseholdProviderError
      ) {
        return c.json({
          success: true,
          data: { ok: false, latencyMs: Date.now() - started, error: "provider_unavailable" },
        });
      }
      const classified = classifyProviderError(error);
      console.error("LLM test probe failed:", classified);
      return c.json({
        success: true,
        data: { ok: false, latencyMs: Date.now() - started, error: classified },
      });
    }
  } catch (error) {
    if (error instanceof KekConfigError) {
      return respondKekConfigError(c, error);
    }
    console.error("Error testing LLM settings:", error);
    return c.json({ success: false, error: "Failed to test LLM settings" }, 500);
  }
});

export default settings;
