import { generateObject } from "ai";
import { openai as openaiProvider, createOpenAI } from "@ai-sdk/openai";
import { anthropic as anthropicProvider, createAnthropic } from "@ai-sdk/anthropic";
import { groq as groqProvider } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { decryptSecret, type EncryptedSecret } from "./crypto";

export type LLMProvider = "openai" | "anthropic" | "groq" | "ollama";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  groq: "llama-3.1-8b-instant",
  ollama: "llama3.2",
};

const DEFAULT_VISION_MODELS: Partial<Record<LLMProvider, string>> = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-sonnet-4-6",
};

export function getModel(): LanguageModel {
  const provider = (process.env.LLM_PROVIDER ?? "openai") as LLMProvider;
  const modelId = process.env.LLM_MODEL ?? DEFAULT_MODELS[provider];

  switch (provider) {
    case "openai":
      return openaiProvider(modelId);
    case "anthropic":
      return anthropicProvider(modelId);
    case "groq":
      return groqProvider(modelId);
    case "ollama": {
      const ollama = createOpenAI({
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      return ollama(modelId);
    }
    default:
      throw new Error(
        `Unsupported LLM_PROVIDER: "${provider}". Valid options: openai, anthropic, groq, ollama`
      );
  }
}

export function getVisionModel(): LanguageModel {
  const provider = (process.env.LLM_PROVIDER ?? "openai") as LLMProvider;
  const modelId = process.env.LLM_VISION_MODEL ?? DEFAULT_VISION_MODELS[provider];

  if (!modelId) {
    throw new Error(
      `LLM_PROVIDER "${provider}" does not support vision. Use openai or anthropic, or set LLM_VISION_MODEL explicitly.`
    );
  }

  switch (provider) {
    case "openai":
      return openaiProvider(modelId);
    case "anthropic":
      return anthropicProvider(modelId);
    default:
      throw new Error(
        `Vision not supported for provider "${provider}". Use openai or anthropic, or set LLM_VISION_MODEL explicitly.`
      );
  }
}

export { generateObject };

// ---------------------------------------------------------------------------------
// Household (BYO-key) model construction — meal planning
//
// getModel()/getVisionModel() above are env-only and bind provider keys at import;
// that is a hard constraint for receipt parsing and expiry estimation, which is why
// this is a SIBLING factory rather than a modification of them.
// ---------------------------------------------------------------------------------

export type HouseholdLLMProvider = "openai" | "openrouter" | "anthropic";

// Base URLs are a fixed, hardcoded map — NEVER derived from user input. Feeding a
// user-supplied base URL into createOpenAI({ baseURL }) is an SSRF primitive (it would
// reach internal services like postgres:5432 or the cloud metadata endpoint from
// inside docker-compose). The user only ever picks a provider enum.
//
// OpenRouter is OpenAI-wire-compatible, so it reuses createOpenAI with a fixed
// baseURL instead of pulling in @openrouter/ai-sdk-provider — a dependency that would
// sit directly on the plaintext-API-key path.
const HOUSEHOLD_PROVIDER_BASE_URLS: Readonly<Record<HouseholdLLMProvider, string | undefined>> = {
  openai: undefined,
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: undefined,
};

const MODEL_ID_PATTERN = /^[a-zA-Z0-9._/-]{1,100}$/;

export class InvalidModelIdError extends Error {
  constructor(modelId: string) {
    super(`Invalid model id: "${modelId}"`);
    this.name = "InvalidModelIdError";
  }
}

export class UnsupportedHouseholdProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported provider: "${provider}"`);
    this.name = "UnsupportedHouseholdProviderError";
  }
}

export interface HouseholdLLMConfig {
  provider: HouseholdLLMProvider;
  model: string;
  apiKey: string;
}

/**
 * Constructs a LanguageModel handle from a household-supplied provider/model/API key.
 * This is the ONLY place a per-household key reaches an AI SDK provider constructor,
 * and the ONLY place a provider's base URL is decided (always from the hardcoded map
 * above, never from `settings`).
 */
function createHouseholdModel(
  provider: HouseholdLLMProvider,
  modelId: string,
  apiKey: string
): LanguageModel {
  if (!MODEL_ID_PATTERN.test(modelId)) {
    throw new InvalidModelIdError(modelId);
  }

  switch (provider) {
    case "openai": {
      const client = createOpenAI({ apiKey, baseURL: HOUSEHOLD_PROVIDER_BASE_URLS.openai });
      return client(modelId);
    }
    case "openrouter": {
      const client = createOpenAI({ apiKey, baseURL: HOUSEHOLD_PROVIDER_BASE_URLS.openrouter });
      return client(modelId);
    }
    case "anthropic": {
      const client = createAnthropic({ apiKey, baseURL: HOUSEHOLD_PROVIDER_BASE_URLS.anthropic });
      return client(modelId);
    }
    default: {
      const exhaustive: never = provider;
      throw new UnsupportedHouseholdProviderError(String(exhaustive));
    }
  }
}

/**
 * Factory for per-household BYO-key model construction (meal planning). Routes
 * through `_deps.createModel` so tests can stub model construction without touching
 * real provider SDKs or making network calls.
 */
export function getModelForHousehold(settings: HouseholdLLMConfig): LanguageModel {
  return _deps.createModel(settings.provider, settings.model, settings.apiKey);
}

// ---------------------------------------------------------------------------------
// Container-wide env-key fallback (plan §4.5) — the SINGLE shared resolver.
//
// Resolution order:
//   1. The household's own encrypted key — always wins when present.
//   2. Else a process-env key for the household's resolved PROVIDER: OPENAI_API_KEY /
//      ANTHROPIC_API_KEY / OPENROUTER_API_KEY. A household that has picked its own
//      provider keeps it — an anthropic household never silently substitutes an
//      OPENAI_API_KEY. Only a household that has never opened Settings (provider ===
//      null, i.e. no settings row at all) inherits the container-wide LLM_PROVIDER
//      default (mirroring getModel() above).
//   3. Else `no_api_key`.
//
// Every call site (generate.ts's two generation workers, the settings.ts /llm/test
// probe, and the meal-plans.ts creation gate) goes through this module instead of
// re-implementing the precedence check.
// ---------------------------------------------------------------------------------

export type LLMKeySource = "household" | "env";

/** Which process-env var backs the container-wide default key for each provider. */
const ENV_API_KEY_VARS: Readonly<Record<HouseholdLLMProvider, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * Fallback model ids used only when a household has never chosen a model AND
 * `LLM_MODEL` is unset. Mirrors `DEFAULT_MODELS` above (openai/anthropic); openrouter
 * has no equivalent there since getModel()/DEFAULT_MODELS is receipt-parsing-scoped
 * and doesn't support openrouter.
 */
const HOUSEHOLD_DEFAULT_MODELS: Readonly<Record<HouseholdLLMProvider, string>> = {
  openai: DEFAULT_MODELS.openai,
  anthropic: DEFAULT_MODELS.anthropic,
  openrouter: "openai/gpt-4o-mini",
};

/**
 * Trims and lowercases `LLM_PROVIDER` for matching. Without this, an operator-typed
 * value like `OpenAI` or `OPENAI ` (both otherwise perfectly valid) fails a strict
 * `===` against the literal `"openai"`, silently resolving to "no default" — the
 * Settings form then seeds empty and Save is blocked by a client guard, with nothing
 * in the UI or logs explaining why. Returns null for unset/blank, distinct from a
 * value that's set but unrecognized (callers below tell those apart).
 */
function normalizeEnvProviderRaw(): string | null {
  const raw = process.env.LLM_PROVIDER;
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * The container-wide default provider, from `LLM_PROVIDER` (trimmed/lowercased, see
 * `normalizeEnvProviderRaw`). Only recognizes the three providers meal planning
 * supports (`HouseholdLLMProvider`) — `groq`/`ollama` are valid for getModel()'s
 * receipt-parsing path but have no meal-planning equivalent, so an operator running
 * receipts on groq does not get an (incorrect) meal-planning fallback out of it.
 */
function resolveEnvProvider(): HouseholdLLMProvider | null {
  const normalized = normalizeEnvProviderRaw();
  if (normalized === null) return "openai"; // unset/blank matches getModel()'s own default
  return normalized === "openai" || normalized === "anthropic" || normalized === "openrouter"
    ? (normalized as HouseholdLLMProvider)
    : null;
}

export interface LLMConfigPreview {
  provider: HouseholdLLMProvider;
  model: string;
  source: LLMKeySource;
}

export interface LLMEnvDefaults {
  provider: HouseholdLLMProvider | null;
  model: string | null;
  /**
   * The raw (trimmed/lowercased) `LLM_PROVIDER` value when it's set to something meal
   * planning doesn't support (`groq`, `ollama`, or a typo) — null in every other case,
   * including when `LLM_PROVIDER` is unset. Lets the API/UI distinguish "operator
   * hasn't configured a default" (both `provider`/`model` null, this also null) from
   * "operator configured something, but it doesn't work here" (this non-null), so the
   * Settings form can explain instead of silently presenting an empty, unseeded form
   * that looks identical to the first case.
   */
  unsupportedProvider: string | null;
}

/**
 * The operator-configured container-wide provider/model default (`LLM_PROVIDER`/
 * `LLM_MODEL`), independent of whether a matching API key is actually present. Unlike
 * `resolveLLMConfigPreview` below, this never checks `ENV_API_KEY_VARS`: a household
 * that has never opened Settings should see the operator's chosen provider/model as
 * pre-filled UI defaults even before any container-wide key exists — the household may
 * bring its own key for that provider (plan §5.6, "UI defaults come from container env
 * config"). Returns `{provider: null, model: null, unsupportedProvider: <raw value>}`
 * when `LLM_PROVIDER` is set to a value meal planning doesn't support.
 */
export function resolveEnvDefaults(): LLMEnvDefaults {
  const provider = resolveEnvProvider();
  if (!provider) {
    return { provider: null, model: null, unsupportedProvider: normalizeEnvProviderRaw() };
  }
  const model = process.env.LLM_MODEL ?? HOUSEHOLD_DEFAULT_MODELS[provider];
  return { provider, model, unsupportedProvider: null };
}

/**
 * Resolves which provider/model/key-source WOULD be used for this household, without
 * touching any actual key material (no decryption, no env value read beyond an
 * existence check). Safe to call on every `GET /settings/llm` and at plan-creation
 * time — the only two places that need to know "is a key configured" without needing
 * the key itself.
 */
export function resolveLLMConfigPreview(params: {
  /** The household's saved provider preference, or null if it has none. */
  provider: HouseholdLLMProvider | null;
  /** The household's saved model preference, or null if it has none. */
  model: string | null;
  /** Whether the household has a stored encrypted key (ciphertext present). */
  hasHouseholdKey: boolean;
}): LLMConfigPreview | null {
  if (params.hasHouseholdKey) {
    // Defensive only: household_llm_settings.provider/model are NOT NULL, so a row
    // that has ciphertext always carries both.
    if (!params.provider || !params.model) return null;
    return { provider: params.provider, model: params.model, source: "household" };
  }

  const candidateProvider = params.provider ?? resolveEnvProvider();
  if (!candidateProvider) return null;
  if (!process.env[ENV_API_KEY_VARS[candidateProvider]]) return null;

  const candidateModel =
    params.model ?? process.env.LLM_MODEL ?? HOUSEHOLD_DEFAULT_MODELS[candidateProvider];
  return { provider: candidateProvider, model: candidateModel, source: "env" };
}

export type ResolveLLMCredentialsResult =
  | { ok: true; credentials: LLMConfigPreview & { apiKey: string } }
  | { ok: false; reason: "no_api_key" };

/**
 * Full resolution INCLUDING the actual key material — the only function that reads a
 * real API key (a decrypted household secret, or a process-env value) for meal-plan
 * generation. Never writes the env key anywhere; it is read fresh from `process.env`
 * every call and never persisted to `household_llm_settings`.
 *
 * Household decryption failures (bad KEK / tampered row / wrong household) propagate
 * unchanged as `SecretDecryptionError`/`KekConfigError` — callers must keep mapping
 * those to `invalid_api_key` (or a 500 for `KekConfigError`), never silently downgrade
 * to the env fallback: a household's own (possibly just-rotated) key always wins over
 * env when one is stored, whether or not it happens to decrypt.
 */
export async function resolveLLMCredentials(params: {
  householdId: string;
  provider: HouseholdLLMProvider | null;
  model: string | null;
  storedSecret: EncryptedSecret | null;
}): Promise<ResolveLLMCredentialsResult> {
  const preview = resolveLLMConfigPreview({
    provider: params.provider,
    model: params.model,
    hasHouseholdKey: params.storedSecret !== null,
  });
  if (!preview) return { ok: false, reason: "no_api_key" };

  const apiKey =
    preview.source === "household"
      ? await decryptSecret(params.storedSecret!, params.householdId)
      : process.env[ENV_API_KEY_VARS[preview.provider]]!;

  return { ok: true, credentials: { ...preview, apiKey } };
}

// Mutable deps object — lets tests replace generateObject / model construction
// without module-level mocking.
export const _deps = { generateObject, createModel: createHouseholdModel };
