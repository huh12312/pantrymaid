/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, mock, afterEach } from "bun:test";
import {
  _deps,
  getModelForHousehold,
  InvalidModelIdError,
  UnsupportedHouseholdProviderError,
  type HouseholdLLMProvider,
} from "../../lib/llm";

const originalCreateModel = _deps.createModel;

afterEach(() => {
  _deps.createModel = originalCreateModel;
});

// Resolves the full request URL a constructed model would send its first request to,
// without ever making a network call — @ai-sdk/openai exposes config.url(), while
// @ai-sdk/anthropic exposes config.baseURL directly.
function resolvedBaseUrl(model: unknown): string {
  const config = (model as any).config;
  if (typeof config.url === "function") {
    return config.url({ path: "", modelId: (model as any).modelId });
  }
  return config.baseURL as string;
}

describe("hardcoded provider base URLs (SSRF guard)", () => {
  test("openai uses the SDK default base URL", () => {
    const model = _deps.createModel("openai", "gpt-4o-mini", "sk-test");
    expect(resolvedBaseUrl(model)).toBe("https://api.openai.com/v1");
  });

  test("openrouter is routed through createOpenAI with the fixed OpenRouter base URL", () => {
    const model = _deps.createModel("openrouter", "openai/gpt-4o-mini", "sk-test");
    expect(resolvedBaseUrl(model)).toBe("https://openrouter.ai/api/v1");
  });

  test("anthropic uses the SDK default base URL", () => {
    const model = _deps.createModel("anthropic", "claude-haiku-4-5-20251001", "sk-ant-test");
    expect(resolvedBaseUrl(model)).toBe("https://api.anthropic.com/v1");
  });

  test("no user-supplied baseURL field reaches the provider constructor, even if smuggled past the type system", () => {
    // HouseholdLLMConfig has no baseURL field at all — this simulates an attacker (or
    // a bug) bypassing that at the TS boundary with `as any`.
    const maliciousSettings = {
      provider: "openrouter" as HouseholdLLMProvider,
      model: "openai/gpt-4o-mini",
      apiKey: "sk-test",
      baseURL: "http://169.254.169.254/latest/meta-data/",
    } as any;

    const model = getModelForHousehold(maliciousSettings);
    // Still resolves to the hardcoded OpenRouter URL, not the injected one.
    expect(resolvedBaseUrl(model)).toBe("https://openrouter.ai/api/v1");
  });
});

describe("model id validation", () => {
  test("accepts a typical model id", () => {
    expect(() => _deps.createModel("openai", "gpt-4o-mini", "sk-test")).not.toThrow();
  });

  test("accepts model ids with dots, slashes, hyphens, underscores", () => {
    expect(() =>
      _deps.createModel("openrouter", "meta-llama/llama-3.1_8b-instruct", "sk-test")
    ).not.toThrow();
  });

  test("rejects a model id containing whitespace", () => {
    expect(() => _deps.createModel("openai", "gpt-4o mini", "sk-test")).toThrow(
      InvalidModelIdError
    );
  });

  test("rejects a model id containing a URL / protocol junk", () => {
    expect(() => _deps.createModel("openai", "http://evil.example.com/steal", "sk-test")).toThrow(
      InvalidModelIdError
    );
  });

  test("rejects an empty model id", () => {
    expect(() => _deps.createModel("openai", "", "sk-test")).toThrow(InvalidModelIdError);
  });

  test("rejects a model id over 100 characters", () => {
    const tooLong = "a".repeat(101);
    expect(() => _deps.createModel("openai", tooLong, "sk-test")).toThrow(InvalidModelIdError);
  });

  test("accepts a model id at exactly 100 characters", () => {
    const maxLength = "a".repeat(100);
    expect(() => _deps.createModel("openai", maxLength, "sk-test")).not.toThrow();
  });

  test("rejects a model id containing shell/SQL-ish metacharacters", () => {
    expect(() => _deps.createModel("openai", "gpt-4o-mini; DROP TABLE x", "sk-test")).toThrow(
      InvalidModelIdError
    );
  });
});

describe("unsupported provider", () => {
  test("throws UnsupportedHouseholdProviderError for a provider outside the enum", () => {
    expect(() => _deps.createModel("groq" as HouseholdLLMProvider, "llama3", "sk-test")).toThrow(
      UnsupportedHouseholdProviderError
    );
  });
});

describe("getModelForHousehold — the _deps.createModel seam", () => {
  test("delegates to _deps.createModel with the exact provider/model/apiKey given", () => {
    let captured: unknown[] = [];
    _deps.createModel = mock((...args: unknown[]) => {
      captured = args;
      return { fake: "model" } as any;
    }) as any;

    const result = getModelForHousehold({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-ant-abc123",
    });

    expect(captured).toEqual(["anthropic", "claude-haiku-4-5-20251001", "sk-ant-abc123"]);
    expect(result).toEqual({ fake: "model" } as any);
  });

  test("is the ONLY function that receives the raw apiKey — stubbing it fully isolates tests from real provider SDKs", () => {
    _deps.createModel = mock(() => ({ fake: "model" }) as any) as any;
    expect(() =>
      getModelForHousehold({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-anything" })
    ).not.toThrow();
    expect(_deps.createModel).toHaveBeenCalledTimes(1);
  });
});
