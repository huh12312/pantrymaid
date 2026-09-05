/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { setupTestDb, teardownTestDb, clearTables, testDb, createTestSession } from "../setup";
import { factories } from "../factories";
import { households, users, householdLlmSettings } from "../../db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import settingsRoute from "../../routes/settings";
import mealPlansRoute from "../../routes/meal-plans";
import { _deps } from "../../lib/llm";

// The container-wide env-key fallback (plan §4.5) reads these directly from
// process.env at resolution time — save/restore around every test so (a) existing
// assertions about "no key configured" stay hermetic regardless of what the ambient
// environment happens to have set, and (b) tests that deliberately exercise the
// fallback can set a value without leaking it into any other test.
const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_VISION_MODEL",
] as const;
let savedEnv: Record<string, string | undefined>;

describe("Settings API Routes", () => {
  let app: Hono;
  let testHousehold: ReturnType<typeof factories.household>;
  let sessionCookie: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  beforeEach(async () => {
    await clearTables();

    testHousehold = factories.household();
    const session = await createTestSession();
    const testUser = factories.user(testHousehold.id, {
      id: session.id,
      displayName: session.name,
    });

    await testDb.insert(households).values(testHousehold);
    await testDb.insert(users).values(testUser);

    sessionCookie = session.cookie;

    app = new Hono();
    app.route("/settings", settingsRoute);
    app.route("/meal-plans", mealPlansRoute);
  });

  function putLlm(body: unknown, cookie: string | null = sessionCookie) {
    return app.request("/settings/llm", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function getLlmRow() {
    const [row] = await testDb
      .select()
      .from(householdLlmSettings)
      .where(eq(householdLlmSettings.householdId, testHousehold.id));
    return row;
  }

  describe("PUT /settings/llm — apiKey null vs. undefined vs. string", () => {
    it("requires authentication", async () => {
      const res = await putLlm(
        { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" },
        null
      );
      expect(res.status).toBe(401);
    });

    it("creates a settings row for the first time with apiKey omitted — no key required to save preferences", async () => {
      const res = await putLlm({ provider: "openai", model: "gpt-4o-mini" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.keyConfigured).toBe(false);
      expect(json.data.keySource).toBeNull();
      expect(json.data.keyLast4).toBeNull();
      expect(json.data.provider).toBe("openai");
      expect(json.data.model).toBe("gpt-4o-mini");

      const row = await getLlmRow();
      expect(row.apiKeyCiphertext).toBeNull();
      expect(row.provider).toBe("openai");
      expect(row.model).toBe("gpt-4o-mini");
    });

    it("creates a settings row for the first time with apiKey: null (nothing to keep, nothing to clear) — also succeeds", async () => {
      const res = await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: null });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.keyConfigured).toBe(false);
      expect(json.data.keyLast4).toBeNull();

      const row = await getLlmRow();
      expect(row.apiKeyCiphertext).toBeNull();
      expect(row.apiKeyIv).toBeNull();
      expect(row.apiKeyTag).toBeNull();
      expect(row.apiKeyLast4).toBeNull();
      expect(row.apiKeyFingerprint).toBeNull();
    });

    it("saves allergies and dietary restrictions with NO key configured, and they round-trip", async () => {
      const res = await putLlm({
        provider: "openai",
        model: "gpt-4o-mini",
        allergies: ["peanuts", "shellfish"],
        dietaryRestrictions: ["vegetarian"],
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.keyConfigured).toBe(false);
      expect(json.data.allergies).toEqual(["peanuts", "shellfish"]);
      expect(json.data.dietaryRestrictions).toEqual(["vegetarian"]);

      // Round-trip via a fresh GET, not just the PUT response.
      const getRes = await app.request("/settings/llm", {
        method: "GET",
        headers: { Cookie: sessionCookie },
      });
      const getJson = await getRes.json();
      expect(getJson.data.allergies).toEqual(["peanuts", "shellfish"]);
      expect(getJson.data.dietaryRestrictions).toEqual(["vegetarian"]);
      expect(getJson.data.keyConfigured).toBe(false);

      const row = await getLlmRow();
      expect(row.allergies).toEqual(["peanuts", "shellfish"]);
      expect(row.dietaryRestrictions).toEqual(["vegetarian"]);
      expect(row.apiKeyCiphertext).toBeNull();
    });

    it("apiKey as a string encrypts and stores the key, never returning key material", async () => {
      const res = await putLlm({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test-key-abcd",
        defaultServings: 4,
        allergies: ["peanuts"],
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.keyConfigured).toBe(true);
      expect(json.data.keySource).toBe("household");
      expect(json.data.keyLast4).toBe("abcd");
      expect(json.data.defaultServings).toBe(4);
      expect(json.data.allergies).toEqual(["peanuts"]);
      // The explicit allow-list in serializeLlmSettings must never leak ciphertext,
      // the full key, or any key-derived material beyond keyConfigured/keyLast4.
      const serialized = JSON.stringify(json.data);
      expect(serialized).not.toContain("sk-test-key-abcd");
      expect(json.data.apiKey).toBeUndefined();
      expect(json.data.apiKeyCiphertext).toBeUndefined();

      const row = await getLlmRow();
      expect(row.apiKeyCiphertext).not.toBeNull();
      expect(row.apiKeyLast4).toBe("abcd");
    });

    it("apiKey omitted on a later PUT keeps the existing key unchanged", async () => {
      await putLlm({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test-key-abcd",
      });
      const before = await getLlmRow();

      const res = await putLlm({
        provider: "openai",
        model: "gpt-4o-mini",
        defaultServings: 6,
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.keyConfigured).toBe(true);
      expect(json.data.keyLast4).toBe("abcd");
      expect(json.data.defaultServings).toBe(6);

      const after = await getLlmRow();
      expect(after.apiKeyCiphertext).toBe(before.apiKeyCiphertext);
      expect(after.apiKeyIv).toBe(before.apiKeyIv);
      expect(after.apiKeyTag).toBe(before.apiKeyTag);
      expect(after.apiKeyFingerprint).toBe(before.apiKeyFingerprint);
    });

    it("apiKey: null clears the key, leaving the rest of the row (provider/model/servings/allergies) intact", async () => {
      await putLlm({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test-key-abcd",
        defaultServings: 5,
        allergies: ["peanuts"],
        dietaryRestrictions: ["vegetarian"],
        weekStartDay: 0,
        timezone: "America/Los_Angeles",
      });

      const res = await putLlm({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: null,
        defaultServings: 5,
        allergies: ["peanuts"],
        dietaryRestrictions: ["vegetarian"],
        weekStartDay: 0,
        timezone: "America/Los_Angeles",
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.keyConfigured).toBe(false);
      expect(json.data.keySource).toBeNull();
      expect(json.data.keyLast4).toBeNull();
      // The row itself survives the clear.
      expect(json.data.provider).toBe("openai");
      expect(json.data.model).toBe("gpt-4o-mini");
      expect(json.data.defaultServings).toBe(5);
      expect(json.data.allergies).toEqual(["peanuts"]);
      expect(json.data.dietaryRestrictions).toEqual(["vegetarian"]);
      expect(json.data.weekStartDay).toBe(0);
      expect(json.data.timezone).toBe("America/Los_Angeles");

      // No recoverable key material survives in the row at all.
      const row = await getLlmRow();
      expect(row.apiKeyCiphertext).toBeNull();
      expect(row.apiKeyIv).toBeNull();
      expect(row.apiKeyTag).toBeNull();
      expect(row.apiKeyLast4).toBeNull();
      expect(row.apiKeyFingerprint).toBeNull();
      expect(row.kekVersion).toBe(1);
      expect(row.provider).toBe("openai");
      expect(row.model).toBe("gpt-4o-mini");
      expect(row.defaultServings).toBe(5);
    });

    it("a subsequent PUT that omits apiKey after a clear does not resurrect the old key", async () => {
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" });
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: null });

      const res = await putLlm({ provider: "openai", model: "gpt-4.1-mini" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.keyConfigured).toBe(false);
      expect(json.data.keyLast4).toBeNull();
      expect(json.data.model).toBe("gpt-4.1-mini");

      const row = await getLlmRow();
      expect(row.apiKeyCiphertext).toBeNull();
      expect(row.apiKeyIv).toBeNull();
      expect(row.apiKeyTag).toBeNull();
      expect(row.apiKeyLast4).toBeNull();
      expect(row.apiKeyFingerprint).toBeNull();
    });

    it("generation fails via the no-API-key path after a clear, not with a stale key", async () => {
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" });
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: null });

      const res = await app.request("/meal-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({
          startDate: "2026-03-02",
          dayCount: 1,
          slots: ["dinner"],
          mode: "balanced",
        }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/configure an ai provider and api key/i);
    });

    it("clearing the household key falls back to the container-wide env key instead of no_api_key, when one is configured (plan §4.5)", async () => {
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" });
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: null });

      // GET must now report the env fallback, not "no key at all".
      const getRes = await app.request("/settings/llm", {
        method: "GET",
        headers: { Cookie: sessionCookie },
      });
      const getJson = await getRes.json();
      expect(getJson.data.keyConfigured).toBe(false);
      expect(getJson.data.keySource).toBeNull();

      process.env.OPENAI_API_KEY = "sk-env-fallback-key";
      try {
        const getResWithEnv = await app.request("/settings/llm", {
          method: "GET",
          headers: { Cookie: sessionCookie },
        });
        const getJsonWithEnv = await getResWithEnv.json();
        expect(getJsonWithEnv.data.keyConfigured).toBe(true);
        expect(getJsonWithEnv.data.keySource).toBe("env");
        // The env key's value/last4/fingerprint never appear anywhere in the response.
        expect(getJsonWithEnv.data.keyLast4).toBeNull();
        expect(JSON.stringify(getJsonWithEnv.data)).not.toContain("sk-env-fallback-key");

        const res = await app.request("/meal-plans", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionCookie },
          body: JSON.stringify({
            startDate: "2026-03-02",
            dayCount: 1,
            slots: ["dinner"],
            mode: "balanced",
          }),
        });
        expect(res.status).toBe(202);
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it("a saved provider preference (anthropic) does NOT fall back to an OPENAI_API_KEY env default — GET reports no key configured", async () => {
      await putLlm({ provider: "anthropic", model: "claude-haiku-4-5-20251001" });

      process.env.OPENAI_API_KEY = "sk-env-wrong-provider";
      try {
        const getRes = await app.request("/settings/llm", {
          method: "GET",
          headers: { Cookie: sessionCookie },
        });
        const getJson = await getRes.json();
        expect(getJson.data.keyConfigured).toBe(false);
        expect(getJson.data.keySource).toBeNull();

        const res = await app.request("/meal-plans", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionCookie },
          body: JSON.stringify({
            startDate: "2026-03-02",
            dayCount: 1,
            slots: ["dinner"],
            mode: "balanced",
          }),
        });
        expect(res.status).toBe(400);
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it("a household that has never opened Settings (no row at all) still reports keyConfigured via the env fallback", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-env-never-configured";
      try {
        const getRes = await app.request("/settings/llm", {
          method: "GET",
          headers: { Cookie: sessionCookie },
        });
        const getJson = await getRes.json();
        expect(getJson.data.provider).toBeNull();
        expect(getJson.data.model).toBeNull();
        expect(getJson.data.keyConfigured).toBe(false); // LLM_PROVIDER unset -> defaults to openai, not anthropic
        expect(getJson.data.keySource).toBeNull();

        process.env.LLM_PROVIDER = "anthropic";
        const getRes2 = await app.request("/settings/llm", {
          method: "GET",
          headers: { Cookie: sessionCookie },
        });
        const getJson2 = await getRes2.json();
        expect(getJson2.data.keyConfigured).toBe(true);
        expect(getJson2.data.keySource).toBe("env");
      } finally {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.LLM_PROVIDER;
      }
    });
  });

  // ---------------------------------------------------------------------------------
  // PUT/GET /settings/llm — visionModel: a per-household override for the receipt-OCR
  // vision model id, following the exact same null-vs-undefined precedent as apiKey
  // (omitted = no change, explicit null = clear back to env/default). See
  // lib/openai.ts's resolveVisionModel for the full precedence chain this exercises
  // end to end at the DB-row level (household → env → per-provider default).
  // ---------------------------------------------------------------------------------
  describe("PUT/GET /settings/llm — visionModel", () => {
    it("omitted on first save leaves visionModel null, and GET reports it alongside envDefaults.visionModel", async () => {
      const res = await putLlm({ provider: "openai", model: "gpt-4o-mini" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.visionModel).toBeNull();
      expect(json.data.envDefaults.visionModel).toBe("gpt-5.4-mini");

      const row = await getLlmRow();
      expect(row.visionModel).toBeNull();
    });

    it("accepts a string visionModel, stores it, and returns it verbatim", async () => {
      const res = await putLlm({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        visionModel: "claude-sonnet-4-6",
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.visionModel).toBe("claude-sonnet-4-6");

      const row = await getLlmRow();
      expect(row.visionModel).toBe("claude-sonnet-4-6");
    });

    it("omitted on a later PUT leaves the previously saved visionModel unchanged", async () => {
      await putLlm({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        visionModel: "claude-sonnet-4-6",
      });

      const res = await putLlm({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        defaultServings: 3,
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.visionModel).toBe("claude-sonnet-4-6");
      expect(json.data.defaultServings).toBe(3);
    });

    it("explicit null clears a previously saved visionModel back to the env/default fallback", async () => {
      await putLlm({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        visionModel: "claude-sonnet-4-6",
      });

      const res = await putLlm({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        visionModel: null,
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.visionModel).toBeNull();

      const row = await getLlmRow();
      expect(row.visionModel).toBeNull();
    });

    it("rejects an invalid model id with the same character/length rules as `model`", async () => {
      const res = await putLlm({
        provider: "openai",
        model: "gpt-4o-mini",
        visionModel: "not a valid model id!",
      });
      expect(res.status).toBe(400);

      const row = await getLlmRow();
      expect(row).toBeUndefined(); // rejected before any write
    });

    it("GET never serializes any key material alongside visionModel", async () => {
      await putLlm({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test-vision-key",
        visionModel: "gpt-5.4-mini",
      });
      const getRes = await app.request("/settings/llm", {
        method: "GET",
        headers: { Cookie: sessionCookie },
      });
      const json = await getRes.json();
      expect(json.data.visionModel).toBe("gpt-5.4-mini");
      const serialized = JSON.stringify(json.data);
      expect(serialized).not.toContain("sk-test-vision-key");
      expect(json.data.apiKeyCiphertext).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------------
  // POST /settings/llm/test — finding 1: unauthenticated-by-household-limit,
  // unrate-limited probe with a real outbound call and an attacker-supplied API key.
  // Fixed by rate-limiting on householdId (plan §6.5 pattern), independent of the
  // generation budget, and bounding maxOutputTokens (plan §4.5).
  // ---------------------------------------------------------------------------------
  describe("POST /settings/llm/test — rate limiting and bounded output (finding 1, 4)", () => {
    const originalGenerateObject = _deps.generateObject;

    afterEach(() => {
      _deps.generateObject = originalGenerateObject;
    });

    function testProbe(body: unknown, cookie: string | null = sessionCookie) {
      return app.request("/settings/llm/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
      });
    }

    it("allows up to 5 rapid calls, then 429s — keyed on householdId, not a header", async () => {
      _deps.generateObject = mock(async () => ({ object: { ready: true } })) as any;
      const body = { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" };

      for (let i = 0; i < 5; i++) {
        const res = await testProbe(body);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.ok).toBe(true);
      }

      const sixth = await testProbe(body);
      expect(sixth.status).toBe(429);
    });

    it("a different household's probe is unaffected by another household's rate limit", async () => {
      _deps.generateObject = mock(async () => ({ object: { ready: true } })) as any;
      const body = { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" };

      for (let i = 0; i < 5; i++) {
        expect((await testProbe(body)).status).toBe(200);
      }
      expect((await testProbe(body)).status).toBe(429);

      // A second household (fresh session) must not be blocked by household A's usage.
      const otherHousehold = factories.household();
      const otherSession = await createTestSession();
      const otherUser = factories.user(otherHousehold.id, {
        id: otherSession.id,
        displayName: otherSession.name,
      });
      await testDb.insert(households).values(otherHousehold);
      await testDb.insert(users).values(otherUser);

      const res = await testProbe(body, otherSession.cookie);
      expect(res.status).toBe(200);
    });

    it("bounds maxOutputTokens on the probe call — a ~5-token response never billed as unbounded", async () => {
      let captured: any;
      _deps.generateObject = mock(async (params: any) => {
        captured = params;
        return { object: { ready: true } };
      }) as any;

      const res = await testProbe({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test-key-abcd",
      });
      expect(res.status).toBe(200);
      expect(typeof captured.maxOutputTokens).toBe("number");
      expect(captured.maxOutputTokens).toBeGreaterThan(0);
      expect(captured.maxOutputTokens).toBeLessThanOrEqual(50);
    });

    // -------------------------------------------------------------------------------
    // Container-wide env-key fallback (plan §4.5) — the probe goes through the same
    // shared resolver as real generation when the request omits apiKey.
    // -------------------------------------------------------------------------------
    it("tests the container-wide env key when the household has saved a provider but no key", async () => {
      let captured: any;
      _deps.generateObject = mock(async (params: any) => {
        captured = params;
        return { object: { ready: true } };
      }) as any;

      await putLlm({ provider: "openai", model: "gpt-4o-mini" }); // no apiKey saved

      process.env.OPENAI_API_KEY = "sk-env-fallback-key";
      try {
        const res = await testProbe({});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.ok).toBe(true);
        // The resolved model handle was built from the env key, never echoed back to
        // the caller — nothing in the response reveals the env key's value.
        expect(JSON.stringify(json)).not.toContain("sk-env-fallback-key");
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
      expect(captured).toBeDefined();
    });

    it("does not fall back across providers: an anthropic-configured household with only OPENAI_API_KEY set gets 400, not a probe using the wrong key", async () => {
      await putLlm({ provider: "anthropic", model: "claude-haiku-4-5-20251001" });

      process.env.OPENAI_API_KEY = "sk-env-wrong-provider";
      try {
        const res = await testProbe({});
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/no api key to test/i);
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it("a household that has never saved settings can still test the pure env default (LLM_PROVIDER/LLM_MODEL + matching key)", async () => {
      let captured: any;
      _deps.generateObject = mock(async (params: any) => {
        captured = params;
        return { object: { ready: true } };
      }) as any;

      process.env.LLM_PROVIDER = "anthropic";
      process.env.LLM_MODEL = "claude-haiku-4-5-20251001";
      process.env.ANTHROPIC_API_KEY = "sk-env-default-key";
      try {
        const res = await testProbe({});
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.ok).toBe(true);
      } finally {
        delete process.env.LLM_PROVIDER;
        delete process.env.LLM_MODEL;
        delete process.env.ANTHROPIC_API_KEY;
      }
      expect(captured).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------------
  // GET /settings/llm — envDefaults (plan §5.6 problem 2). Independent of whether a
  // matching API key exists: a household that has never opened Settings should still
  // see the operator's container-wide provider/model as pre-fill suggestions.
  // ---------------------------------------------------------------------------------
  describe("GET /settings/llm — envDefaults", () => {
    async function getLlm() {
      const res = await app.request("/settings/llm", { headers: { Cookie: sessionCookie } });
      return res.json();
    }

    it("defaults to openai/gpt-4o-mini when LLM_PROVIDER/LLM_MODEL are both unset, with no key required", async () => {
      const json = await getLlm();
      expect(json.data.envDefaults).toEqual({
        provider: "openai",
        model: "gpt-4o-mini",
        visionModel: "gpt-5.4-mini",
      });
    });

    it("reflects a configured LLM_PROVIDER with no LLM_MODEL via that provider's built-in default", async () => {
      process.env.LLM_PROVIDER = "anthropic";
      try {
        const json = await getLlm();
        expect(json.data.envDefaults).toEqual({
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          visionModel: "claude-sonnet-4-6",
        });
      } finally {
        delete process.env.LLM_PROVIDER;
      }
    });

    it("reflects both LLM_PROVIDER and LLM_MODEL when both are set", async () => {
      process.env.LLM_PROVIDER = "anthropic";
      process.env.LLM_MODEL = "claude-sonnet-4-6";
      try {
        const json = await getLlm();
        expect(json.data.envDefaults).toEqual({
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          visionModel: "claude-sonnet-4-6",
        });
      } finally {
        delete process.env.LLM_PROVIDER;
        delete process.env.LLM_MODEL;
      }
    });

    it("is null/null/null for a provider meal planning doesn't support (e.g. groq)", async () => {
      process.env.LLM_PROVIDER = "groq";
      try {
        const json = await getLlm();
        expect(json.data.envDefaults).toEqual({ provider: null, model: null, visionModel: null });
      } finally {
        delete process.env.LLM_PROVIDER;
      }
    });

    it("LLM_VISION_MODEL overrides the per-provider vision default in envDefaults", async () => {
      process.env.LLM_VISION_MODEL = "gpt-vision-env-override";
      try {
        const json = await getLlm();
        expect(json.data.envDefaults.visionModel).toBe("gpt-vision-env-override");
      } finally {
        delete process.env.LLM_VISION_MODEL;
      }
    });

    it("still reports envDefaults once the household has saved its own provider/model", async () => {
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" });
      process.env.LLM_PROVIDER = "anthropic";
      try {
        const json = await getLlm();
        // Household's own saved values win at the top level...
        expect(json.data.provider).toBe("openai");
        expect(json.data.model).toBe("gpt-4o-mini");
        // ...independent of envDefaults, which always reflects the operator's env.
        expect(json.data.envDefaults.provider).toBe("anthropic");
      } finally {
        delete process.env.LLM_PROVIDER;
      }
    });
  });

  // ---------------------------------------------------------------------------------
  // GET /settings/llm/models — a LIVE model catalogue fetched from the provider's own
  // API (plan §5.6), replacing a hardcoded frontend list. Every scenario stubs
  // global.fetch — no real network calls are ever made from this suite.
  // ---------------------------------------------------------------------------------
  describe("GET /settings/llm/models", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    function getModels(provider: string, cookie: string | null = sessionCookie) {
      return app.request(`/settings/llm/models?provider=${provider}`, {
        method: "GET",
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
      });
    }

    it("requires authentication", async () => {
      const res = await getModels("openai", null);
      expect(res.status).toBe(401);
    });

    it("rejects an unsupported provider value", async () => {
      const res = await getModels("groq");
      expect(res.status).toBe(400);
    });

    it("returns no_api_key with an empty list when the household has no key for that provider", async () => {
      const res = await getModels("openai");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.provider).toBe("openai");
      expect(json.data.models).toEqual([]);
      expect(json.data.reason).toBe("no_api_key");
    });

    it("openai: fetches the live catalogue, sorts newest first, and filters out non-chat models", async () => {
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" });
      let capturedUrl: string | undefined;
      let capturedAuth: string | undefined;
      global.fetch = mock(async (url: any, init?: any) => {
        capturedUrl = url.toString();
        capturedAuth = init?.headers?.Authorization;
        return new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o-mini", created: 1000 },
              { id: "gpt-5.4-mini", created: 2000 },
              { id: "whisper-1", created: 1500 },
              { id: "text-embedding-3-small", created: 1200 },
            ],
          }),
          { status: 200 }
        );
      }) as any;

      const res = await getModels("openai");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.reason).toBeNull();
      // whisper-1/text-embedding-3-small filtered out; newest (highest `created`) first.
      expect(json.data.models).toEqual(["gpt-5.4-mini", "gpt-4o-mini"]);
      expect(capturedUrl).toBe("https://api.openai.com/v1/models");
      expect(capturedAuth).toBe("Bearer sk-test-key-abcd");
    });

    it("anthropic: fetches the live catalogue with x-api-key + anthropic-version headers", async () => {
      await putLlm({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-abcd",
      });
      let capturedHeaders: Record<string, string> | undefined;
      global.fetch = mock(async (_url: any, init?: any) => {
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            data: [
              { id: "claude-haiku-4-5-20251001", created_at: "2025-10-01T00:00:00Z" },
              { id: "claude-sonnet-4-6", created_at: "2026-01-01T00:00:00Z" },
            ],
          }),
          { status: 200 }
        );
      }) as any;

      const res = await getModels("anthropic");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.models).toEqual(["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]);
      expect(capturedHeaders?.["x-api-key"]).toBe("sk-ant-abcd");
      expect(capturedHeaders?.["anthropic-version"]).toBe("2023-06-01");
    });

    it("openrouter: fetches the live catalogue with NO auth headers, even with no key configured", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      global.fetch = mock(async (_url: any, init?: any) => {
        capturedHeaders = init?.headers ?? {};
        return new Response(
          JSON.stringify({ data: [{ id: "openai/gpt-4o-mini", created: 1000 }] }),
          {
            status: 200,
          }
        );
      }) as any;

      const res = await getModels("openrouter");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.models).toEqual(["openai/gpt-4o-mini"]);
      expect(json.data.reason).toBeNull();
      expect(capturedHeaders?.Authorization).toBeUndefined();
      expect(capturedHeaders?.["x-api-key"]).toBeUndefined();
    });

    it("maps a 401 from the provider to invalid_key without leaking the response body", async () => {
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" });
      global.fetch = mock(
        async () =>
          new Response(
            JSON.stringify({ error: { message: "Incorrect API key: sk-test-key-abcd" } }),
            { status: 401 }
          )
      ) as any;

      const res = await getModels("openai");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.reason).toBe("invalid_key");
      expect(json.data.models).toEqual([]);
      expect(JSON.stringify(json)).not.toContain("sk-test-key-abcd");
    });

    it("a network failure maps to provider_unavailable, never a 500", async () => {
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" });
      global.fetch = mock(async () => {
        throw new Error("connect ECONNREFUSED");
      }) as any;

      const res = await getModels("openai");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.reason).toBe("provider_unavailable");
      expect(json.data.models).toEqual([]);
    });

    it("caches per (household, provider): a second request within the window makes no second upstream call", async () => {
      await putLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-key-abcd" });
      let callCount = 0;
      global.fetch = mock(async () => {
        callCount++;
        return new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini", created: 1 }] }), {
          status: 200,
        });
      }) as any;

      const first = await getModels("openai");
      expect(first.status).toBe(200);
      const second = await getModels("openai");
      expect(second.status).toBe(200);
      expect(callCount).toBe(1);

      const secondJson = await second.json();
      expect(secondJson.data.models).toEqual(["gpt-4o-mini"]);
    });

    it("rate-limits on householdId — allows up to the limit, then 429s", async () => {
      global.fetch = mock(
        async () =>
          new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini", created: 1 }] }), {
            status: 200,
          })
      ) as any;

      // Cycle providers so the CACHE isn't what's limiting repeat calls — the rate
      // limiter is keyed on householdId alone (not per-provider), so this exercises it
      // specifically rather than incidentally relying on cache misses.
      const providers = ["openai", "anthropic", "openrouter"];
      let lastStatus = 200;
      for (let i = 0; i < 21; i++) {
        const res = await getModels(providers[i % providers.length]);
        lastStatus = res.status;
      }
      expect(lastStatus).toBe(429);
    });

    it("a different household's requests are unaffected by another household's rate limit", async () => {
      global.fetch = mock(
        async () =>
          new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini", created: 1 }] }), {
            status: 200,
          })
      ) as any;

      for (let i = 0; i < 20; i++) {
        expect((await getModels("openai")).status).toBe(200);
      }
      expect((await getModels("openai")).status).toBe(429);

      const otherHousehold = factories.household();
      const otherSession = await createTestSession();
      const otherUser = factories.user(otherHousehold.id, {
        id: otherSession.id,
        displayName: otherSession.name,
      });
      await testDb.insert(households).values(otherHousehold);
      await testDb.insert(users).values(otherUser);

      const res = await getModels("openai", otherSession.cookie);
      expect(res.status).toBe(200);
    });
  });
});
