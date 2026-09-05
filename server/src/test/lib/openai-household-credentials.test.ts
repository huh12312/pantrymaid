/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Unifies LLM credential resolution across openai.ts's five call sites (receipt OCR,
 * expiration estimation, brand extraction, name normalization, item-default
 * suggestion) with meal planning's household BYO-key model (plan §4.5, §6).
 *
 * These tests stub `_householdDeps.loadHouseholdLlmRow` (openai.ts's own DI seam) with
 * in-memory rows instead of touching Postgres — the row shape is identical to what a
 * real `household_llm_settings` SELECT returns, and ciphertext is produced via the
 * REAL `encryptSecret` so decryption / AAD-mismatch behavior is exercised for real,
 * exactly as `src/test/lib/llm-resolve.test.ts` does for the meal-planning path.
 *
 * `_deps.createModel` (llm.ts) is stubbed as a spy: any household-routed call MUST go
 * through `getModelForHousehold` -> `_deps.createModel`, so asserting on its call
 * count/args is how these tests distinguish "household path taken" from "legacy
 * getModel()/getVisionModel() env-only path taken" without needing to construct real
 * provider SDK clients.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  estimateExpiration,
  extractBrandFromName,
  normalizeItemName,
  suggestItemDefaults,
  parseReceiptImage,
  clearExpirationCache,
  clearBrandCache,
  clearNormalizeCache,
  clearSuggestionCache,
  _householdDeps,
} from "../../lib/openai";
import { _deps } from "../../lib/llm";
import { encryptSecret } from "../../lib/crypto";
import type { householdLlmSettings } from "../../db/schema";

type HouseholdLlmRow = typeof householdLlmSettings.$inferSelect;

const originalGenerateObject = _deps.generateObject;
const originalCreateModel = _deps.createModel;
const originalLoadHouseholdLlmRow = _householdDeps.loadHouseholdLlmRow;

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_VISION_MODEL",
] as const;
let savedEnv: Record<string, string | undefined>;

let createModelCalls: Array<{ provider: string; model: string; apiKey: string }>;

function stubCreateModel() {
  createModelCalls = [];
  _deps.createModel = mock((provider: any, model: any, apiKey: any) => {
    createModelCalls.push({ provider, model, apiKey });
    // A cheap marker object stands in for a real LanguageModel — nothing downstream
    // in these tests calls provider SDK methods on it.
    return { __household: true, provider, model, apiKey } as any;
  }) as any;
}

function stubGenerateObject(returnValue: unknown) {
  _deps.generateObject = mock(async () => ({ object: returnValue })) as any;
}

function rowFor(overrides: Partial<HouseholdLlmRow> & { provider: string; model: string }) {
  return {
    householdId: "unused-in-these-tests",
    visionModel: null,
    apiKeyCiphertext: null,
    apiKeyIv: null,
    apiKeyTag: null,
    apiKeyLast4: null,
    apiKeyFingerprint: null,
    kekVersion: 1,
    defaultServings: 2,
    allergies: [],
    dietaryRestrictions: [],
    weekStartDay: 1,
    timezone: "America/New_York",
    monthlyTokenCap: null,
    updatedBy: null,
    updatedAt: new Date(),
    ...overrides,
  } as HouseholdLlmRow;
}

async function rowWithKey(
  householdId: string,
  provider: string,
  model: string,
  plaintextKey: string
): Promise<HouseholdLlmRow> {
  const secret = await encryptSecret(plaintextKey, householdId);
  return rowFor({
    householdId,
    provider,
    model,
    apiKeyCiphertext: secret.ciphertext,
    apiKeyIv: secret.iv,
    apiKeyTag: secret.tag,
    kekVersion: secret.kekVersion,
  });
}

/** Encrypts under a DIFFERENT household id so AES-GCM AAD verification fails when
 * decrypted for `householdId` — a stored key that can never be decrypted (corrupted
 * row / wrong KEK / tampered ciphertext), the "broken key" scenario. */
async function rowWithBrokenKey(
  householdId: string,
  provider: string,
  model: string
): Promise<HouseholdLlmRow> {
  const secret = await encryptSecret("sk-irrelevant-plaintext", `not-${householdId}`);
  return rowFor({
    householdId,
    provider,
    model,
    apiKeyCiphertext: secret.ciphertext,
    apiKeyIv: secret.iv,
    apiKeyTag: secret.tag,
    kekVersion: secret.kekVersion,
  });
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  stubCreateModel();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  _deps.generateObject = originalGenerateObject;
  _deps.createModel = originalCreateModel;
  _householdDeps.loadHouseholdLlmRow = originalLoadHouseholdLlmRow;
  clearExpirationCache();
  clearBrandCache();
  clearNormalizeCache();
  clearSuggestionCache();
});

describe("household key drives text-generation call sites", () => {
  test("estimateExpiration uses the household's stored encrypted key/provider/model", async () => {
    _householdDeps.loadHouseholdLlmRow = async (householdId) =>
      rowWithKey(householdId, "anthropic", "claude-haiku-4-5-20251001", "sk-household-real-key");
    stubGenerateObject({ days: 5, label: "~5 days", confidence: "high" });

    const result = await estimateExpiration("Household-Key-Test-Product", undefined, "household-a");

    expect(result.days).toBe(5);
    expect(createModelCalls).toEqual([
      {
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-household-real-key",
      },
    ]);
  });

  test("extractBrandFromName falls back to the operator's provider-matched env key when the household has no stored key", async () => {
    process.env.OPENAI_API_KEY = "sk-env-fallback-key";
    _householdDeps.loadHouseholdLlmRow = async (householdId) =>
      rowFor({ householdId, provider: "openai", model: "gpt-4o" }); // no ciphertext columns
    stubGenerateObject({ brand: "Acme" });

    const brand = await extractBrandFromName("Acme Env-Fallback Widget", "household-b");

    expect(brand).toBe("Acme");
    expect(createModelCalls).toEqual([
      { provider: "openai", model: "gpt-4o", apiKey: "sk-env-fallback-key" },
    ]);
  });

  test("no householdId supplied -> legacy env-only path, never touches the household model factory", async () => {
    stubGenerateObject({ normalized: "apple" });

    const normalized = await normalizeItemName("Granny Smith Apples No-Household-Test");

    expect(normalized).toBe("apple");
    expect(createModelCalls).toEqual([]);
    // Confirms the DB/decrypt lookup itself was never attempted for this path.
    let lookupCalled = false;
    _householdDeps.loadHouseholdLlmRow = async () => {
      lookupCalled = true;
      return undefined;
    };
    await normalizeItemName("Another No-Household-Test", undefined);
    expect(lookupCalled).toBe(false);
  });

  test("household has no configured key at all and no env fallback exists -> legacy env-only path, not an error", async () => {
    _householdDeps.loadHouseholdLlmRow = async (householdId) =>
      rowFor({ householdId, provider: "anthropic", model: "claude-haiku-4-5-20251001" });
    stubGenerateObject({ unit: "unit", category: "Produce", estimatedShelfDays: 21 });

    const suggestion = await suggestItemDefaults("No-Key-Anywhere-Test-Item", "household-c");

    expect(suggestion.category).toBe("Produce");
    expect(createModelCalls).toEqual([]);
  });

  test("a broken household key (fails to decrypt) degrades gracefully instead of throwing into the route", async () => {
    _householdDeps.loadHouseholdLlmRow = async (householdId) =>
      rowWithBrokenKey(householdId, "openai", "gpt-4o-mini");
    stubGenerateObject({ unit: "unit", category: "Produce", estimatedShelfDays: 21 });

    // Must not throw — this is a background/best-effort feature, not an explicit,
    // user-initiated action like meal-plan generation.
    const suggestion = await suggestItemDefaults("Broken-Key-Test-Item", "household-broken");

    expect(suggestion.category).toBe("Produce");
    expect(createModelCalls).toEqual([]); // fell back to legacy getModel(), never reached createModel
  });

  test("cache keys don't collide across households configured with different providers/models", async () => {
    let callCount = 0;
    _deps.generateObject = mock(async () => {
      callCount++;
      return { object: { days: 3, label: "~3 days", confidence: "high" } };
    }) as any;

    const rows: Record<string, HouseholdLlmRow> = {};
    _householdDeps.loadHouseholdLlmRow = async (householdId) => rows[householdId];
    rows["household-x"] = await rowWithKey(
      "household-x",
      "openai",
      "gpt-4o-mini",
      "sk-household-x"
    );
    rows["household-y"] = await rowWithKey(
      "household-y",
      "anthropic",
      "claude-haiku-4-5-20251001",
      "sk-household-y"
    );

    const productName = "Shared-Product-Name-Cache-Test";
    await estimateExpiration(productName, undefined, "household-x");
    await estimateExpiration(productName, undefined, "household-y");
    expect(callCount).toBe(2); // distinct households, distinct cache entries

    await estimateExpiration(productName, undefined, "household-x"); // same household+input -> cached
    expect(callCount).toBe(2);

    await estimateExpiration(productName, undefined, "household-y"); // same household+input -> cached
    expect(callCount).toBe(2);
  });
});

describe("vision resolution (parseReceiptImage) — key follows the household, model stays env/default-driven", () => {
  test("household's key + provider are used, but the vision model id is NOT the household's saved chat model", async () => {
    _householdDeps.loadHouseholdLlmRow = async (householdId) =>
      rowWithKey(householdId, "anthropic", "claude-haiku-4-5-20251001", "sk-vision-household-key");
    stubGenerateObject({ storeName: "Test Store", lineItems: [], total: null });

    await parseReceiptImage("aGVsbG8=", "household-vision");

    expect(createModelCalls).toHaveLength(1);
    expect(createModelCalls[0].provider).toBe("anthropic");
    expect(createModelCalls[0].apiKey).toBe("sk-vision-household-key");
    // The household's chat model (claude-haiku, not vision-capable) must never be sent
    // receipts — the vision-capable default for the resolved provider is used instead.
    expect(createModelCalls[0].model).not.toBe("claude-haiku-4-5-20251001");
    expect(createModelCalls[0].model).toBe("claude-sonnet-4-6");
  });

  test("household visionModel override wins over LLM_VISION_MODEL env and the per-provider default", async () => {
    process.env.LLM_VISION_MODEL = "claude-vision-env-should-lose";
    _householdDeps.loadHouseholdLlmRow = async (householdId) => ({
      ...(await rowWithKey(
        householdId,
        "anthropic",
        "claude-haiku-4-5-20251001",
        "sk-vision-household-key"
      )),
      visionModel: "claude-vision-household-override",
    });
    stubGenerateObject({ storeName: null, lineItems: [], total: null });

    await parseReceiptImage("aGVsbG8=", "household-vision-override-wins");

    expect(createModelCalls[0].model).toBe("claude-vision-household-override");
  });

  test("LLM_VISION_MODEL env override wins over the per-provider default even on the household path", async () => {
    process.env.LLM_VISION_MODEL = "claude-vision-override";
    _householdDeps.loadHouseholdLlmRow = async (householdId) =>
      rowWithKey(householdId, "anthropic", "claude-haiku-4-5-20251001", "sk-vision-household-key");
    stubGenerateObject({ storeName: null, lineItems: [], total: null });

    await parseReceiptImage("aGVsbG8=", "household-vision-override");

    expect(createModelCalls[0].model).toBe("claude-vision-override");
  });

  test("a provider with no known vision-capable default (openrouter) falls back to the legacy env-only vision path", async () => {
    _householdDeps.loadHouseholdLlmRow = async (householdId) =>
      rowWithKey(householdId, "openrouter", "meta-llama/llama-3.1-8b-instruct", "sk-or-key");
    stubGenerateObject({ storeName: null, lineItems: [], total: null });

    // getVisionModel() throws when neither LLM_VISION_MODEL nor a provider default is
    // set for the (unset -> "openai") env provider default and there's no vision
    // model configured — set LLM_PROVIDER/vision env so the legacy fallback itself
    // succeeds, isolating the assertion to "openrouter never reaches createModel".
    process.env.LLM_PROVIDER = "openai";

    await parseReceiptImage("aGVsbG8=", "household-openrouter");

    expect(createModelCalls).toEqual([]);
  });

  test("no householdId supplied -> legacy getVisionModel() path, never touches the household model factory", async () => {
    stubGenerateObject({ storeName: null, lineItems: [], total: null });

    await parseReceiptImage("aGVsbG8=");

    expect(createModelCalls).toEqual([]);
  });
});
