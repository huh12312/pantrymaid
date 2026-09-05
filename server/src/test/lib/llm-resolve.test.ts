/**
 * The shared household-key / env-key resolver (plan §4.5): household's own encrypted
 * key -> process-env key for the household's resolved PROVIDER -> `no_api_key`. This
 * is the ONE place that precedence is decided; generate.ts's two generation workers,
 * the /settings/llm/test probe, and the meal-plans.ts creation gate all delegate here
 * instead of re-implementing it (see server/src/lib/llm.ts).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveLLMConfigPreview, resolveLLMCredentials } from "../../lib/llm";
import { encryptSecret, SecretDecryptionError, type EncryptedSecret } from "../../lib/crypto";

const HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_HOUSEHOLD_ID = "22222222-2222-2222-2222-222222222222";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "LLM_PROVIDER",
  "LLM_MODEL",
  // Saved/restored like the rest, then re-seeded per test below. These tests call the
  // REAL encryptSecret, so a KEK must exist — relying on the developer's .env leaking
  // one in makes the suite pass locally and fail in CI, which is exactly what happened.
  "MEAL_PLAN_KEK",
] as const;

/** Matches the self-contained pattern in `crypto.test.ts` — no ambient KEK required. */
function randomBase64Kek(byteLength = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(byteLength))).toString("base64");
}

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.MEAL_PLAN_KEK = randomBase64Kek();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function storedSecretFor(householdId: string, plaintext: string): Promise<EncryptedSecret> {
  return encryptSecret(plaintext, householdId);
}

describe("resolveLLMConfigPreview — non-decrypting preview (GET /settings/llm, plan creation gate)", () => {
  test("household key present -> source household, echoes household provider/model", () => {
    const result = resolveLLMConfigPreview({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      hasHouseholdKey: true,
    });
    expect(result).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      source: "household",
    });
  });

  test("no household key, env key present for the household's chosen provider -> source env", () => {
    process.env.OPENAI_API_KEY = "sk-env-test-key";
    const result = resolveLLMConfigPreview({
      provider: "openai",
      model: "gpt-4o-mini",
      hasHouseholdKey: false,
    });
    expect(result).toEqual({ provider: "openai", model: "gpt-4o-mini", source: "env" });
  });

  test("provider mismatch: household chose anthropic, only OPENAI_API_KEY is set -> null (no_api_key), never substitutes openai", () => {
    process.env.OPENAI_API_KEY = "sk-env-test-key";
    const result = resolveLLMConfigPreview({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      hasHouseholdKey: false,
    });
    expect(result).toBeNull();
  });

  test("household never opened Settings (provider/model null) -> inherits LLM_PROVIDER/LLM_MODEL env default", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_MODEL = "claude-haiku-4-5-20251001";
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-test-key";
    const result = resolveLLMConfigPreview({ provider: null, model: null, hasHouseholdKey: false });
    expect(result).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      source: "env",
    });
  });

  test("household never opened Settings and LLM_PROVIDER is unset -> defaults to openai, matching getModel()'s own default", () => {
    process.env.OPENAI_API_KEY = "sk-env-test-key";
    const result = resolveLLMConfigPreview({ provider: null, model: null, hasHouseholdKey: false });
    expect(result?.provider).toBe("openai");
    expect(result?.source).toBe("env");
  });

  test("household never opened Settings, LLM_MODEL unset -> falls back to a household-provider default model", () => {
    process.env.OPENAI_API_KEY = "sk-env-test-key";
    const result = resolveLLMConfigPreview({ provider: null, model: null, hasHouseholdKey: false });
    expect(typeof result?.model).toBe("string");
    expect(result?.model.length).toBeGreaterThan(0);
  });

  test("LLM_PROVIDER set to a receipt-parsing-only provider (groq) has no meal-planning equivalent -> null", () => {
    process.env.LLM_PROVIDER = "groq";
    process.env.OPENAI_API_KEY = "sk-env-test-key"; // present, but for the wrong provider entirely
    const result = resolveLLMConfigPreview({ provider: null, model: null, hasHouseholdKey: false });
    expect(result).toBeNull();
  });

  test("no household key and no env key anywhere -> null (no_api_key)", () => {
    const result = resolveLLMConfigPreview({
      provider: "openai",
      model: "gpt-4o-mini",
      hasHouseholdKey: false,
    });
    expect(result).toBeNull();
  });

  test("hasHouseholdKey true but provider/model missing (defensive-only branch) -> null", () => {
    const result = resolveLLMConfigPreview({ provider: null, model: null, hasHouseholdKey: true });
    expect(result).toBeNull();
  });
});

describe("resolveLLMCredentials — full resolution including real key material", () => {
  test("household key wins over an available env key for the SAME provider (precedence table row 1)", async () => {
    process.env.OPENAI_API_KEY = "sk-env-should-not-be-used";
    const storedSecret = await storedSecretFor(HOUSEHOLD_ID, "sk-household-real-key");

    const result = await resolveLLMCredentials({
      householdId: HOUSEHOLD_ID,
      provider: "openai",
      model: "gpt-4o-mini",
      storedSecret,
    });

    expect(result).toEqual({
      ok: true,
      credentials: {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-household-real-key",
        source: "household",
      },
    });
  });

  test("env is used when the household has no key at all (precedence table row 2)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";

    const result = await resolveLLMCredentials({
      householdId: HOUSEHOLD_ID,
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      storedSecret: null,
    });

    expect(result).toEqual({
      ok: true,
      credentials: {
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-env-key",
        source: "env",
      },
    });
  });

  test("provider mismatch does NOT fall back: anthropic household + only OPENAI_API_KEY set -> no_api_key (precedence table row 3)", async () => {
    process.env.OPENAI_API_KEY = "sk-env-key";

    const result = await resolveLLMCredentials({
      householdId: HOUSEHOLD_ID,
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      storedSecret: null,
    });

    expect(result).toEqual({ ok: false, reason: "no_api_key" });
  });

  test("clearing a household key (storedSecret -> null) falls back to env, not to no_api_key (precedence table row 4)", async () => {
    // Simulates PUT /settings/llm { apiKey: null }: the household's provider choice
    // survives the clear (still "openai" in this scenario), only the key is gone.
    process.env.OPENAI_API_KEY = "sk-env-key-after-clear";

    const result = await resolveLLMCredentials({
      householdId: HOUSEHOLD_ID,
      provider: "openai",
      model: "gpt-4o-mini",
      storedSecret: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credentials.source).toBe("env");
      expect(result.credentials.apiKey).toBe("sk-env-key-after-clear");
    }
  });

  test("no household key and no env key -> no_api_key exactly as before", async () => {
    const result = await resolveLLMCredentials({
      householdId: HOUSEHOLD_ID,
      provider: "openai",
      model: "gpt-4o-mini",
      storedSecret: null,
    });
    expect(result).toEqual({ ok: false, reason: "no_api_key" });
  });

  test("an OpenRouter env key resolves via OPENROUTER_API_KEY specifically, not OPENAI_API_KEY", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-should-not-be-used";
    process.env.OPENROUTER_API_KEY = "sk-or-env-key";

    const result = await resolveLLMCredentials({
      householdId: HOUSEHOLD_ID,
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      storedSecret: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credentials.apiKey).toBe("sk-or-env-key");
      expect(result.credentials.source).toBe("env");
    }
  });

  test("a stored secret encrypted for a DIFFERENT household fails to decrypt (AAD mismatch) and throws SecretDecryptionError, never silently falling back to env", async () => {
    process.env.OPENAI_API_KEY = "sk-env-should-not-be-reached";
    const storedSecret = await storedSecretFor(OTHER_HOUSEHOLD_ID, "sk-household-real-key");

    await expect(
      resolveLLMCredentials({
        householdId: HOUSEHOLD_ID, // wrong household relative to the ciphertext's AAD
        provider: "openai",
        model: "gpt-4o-mini",
        storedSecret,
      })
    ).rejects.toBeInstanceOf(SecretDecryptionError);
  });

  test("household provider/model are echoed back verbatim even when an env key also exists for a different provider", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-unused";
    const storedSecret = await storedSecretFor(HOUSEHOLD_ID, "sk-household-key");

    const result = await resolveLLMCredentials({
      householdId: HOUSEHOLD_ID,
      provider: "openrouter",
      model: "meta-llama/llama-3.1-8b-instruct",
      storedSecret,
    });

    expect(result).toEqual({
      ok: true,
      credentials: {
        provider: "openrouter",
        model: "meta-llama/llama-3.1-8b-instruct",
        apiKey: "sk-household-key",
        source: "household",
      },
    });
  });
});

describe("env-supplied model id still goes through the same regex validation as a user-supplied one", () => {
  // resolveLLMCredentials/resolveLLMConfigPreview never validate the model id
  // themselves (they don't construct a provider client) — validation happens where it
  // always has, in getModelForHousehold via _deps.createModel. This just confirms an
  // env-derived model flows through that same call unmodified, so a junk value is
  // rejected exactly like a saved one would be.
  test("a well-formed env-derived model id passes getModelForHousehold's validation", async () => {
    const { getModelForHousehold } = await import("../../lib/llm");
    expect(() =>
      getModelForHousehold({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" })
    ).not.toThrow();
  });

  test("a junk env-derived model id (e.g. a URL smuggled via LLM_MODEL) is rejected by getModelForHousehold", async () => {
    const { getModelForHousehold, InvalidModelIdError } = await import("../../lib/llm");
    expect(() =>
      getModelForHousehold({
        provider: "openai",
        model: "http://evil.example.com/steal",
        apiKey: "sk-test",
      })
    ).toThrow(InvalidModelIdError);
  });
});
