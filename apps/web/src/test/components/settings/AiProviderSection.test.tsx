import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../mocks/server";
import { AiProviderSection } from "@/components/settings/AiProviderSection";

// jsdom doesn't implement these; Radix Select's pointer-based open/close logic needs
// them (verified empirically against this exact jsdom/Radix version pairing — no
// polyfill for this exists in the shared test setup, so it's scoped to this file only).
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

const API_BASE = "http://localhost:3000";

// Never actually sent to or returned from any mock in this file — it exists purely so
// the "never rendered" assertions have a concrete, memorable string to search for.
const FULL_KEY = "sk-live-THIS-MUST-NEVER-RENDER-abcdef7f2c";

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AiProviderSection />
    </QueryClientProvider>
  );
}

// Waits not just for the combobox to exist (it does even mid-loading-race), but for
// the component's seed-from-query-data effect to have actually run — that effect fires
// one render after the query resolves, so asserting only on the combobox's presence
// can win a race against it and read stale (pre-seed) form state.
async function waitForLoaded(expectedModel = "gpt-4o-mini") {
  await screen.findByRole("combobox", { name: /provider/i });
  await waitFor(() => {
    expect((screen.getByLabelText(/^model$/i) as HTMLInputElement).value).toBe(expectedModel);
  });
}

describe("AiProviderSection", () => {
  beforeEach(() => {
    // Default handlers (src/test/mocks/handlers.ts) return a configured openai key
    // with keyLast4 "7f2c" and model "gpt-4o-mini" — used as the happy-path baseline
    // and overridden per test where a different starting state is needed.
  });

  it("shows the masked key and never the full key text anywhere on the page", async () => {
    renderSection();
    await waitForLoaded();
    expect(screen.getByText("••••7f2c")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(FULL_KEY);
  });

  it("submitting untouched sends no apiKey field at all", async () => {
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put(`${API_BASE}/api/settings/llm`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: {
            provider: "openai",
            model: "gpt-4o-mini",
            keyConfigured: true,
            keyLast4: "7f2c",
            defaultServings: 4,
            allergies: [],
            dietaryRestrictions: [],
            weekStartDay: 1,
            timezone: "America/New_York",
          },
        });
      })
    );

    renderSection();
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /save ai settings/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).not.toBeNull();
    expect("apiKey" in (capturedBody as Record<string, unknown>)).toBe(false);
    // provider/model are required by the PUT schema regardless — must still be sent.
    expect((capturedBody as Record<string, unknown>).provider).toBe("openai");
    expect((capturedBody as Record<string, unknown>).model).toBe("gpt-4o-mini");
  });

  it("Replace flow: typing a new key and saving sends exactly that value as apiKey", async () => {
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put(`${API_BASE}/api/settings/llm`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: {
            provider: "openai",
            model: "gpt-4o-mini",
            keyConfigured: true,
            keyLast4: "9999",
            defaultServings: 4,
            allergies: [],
            dietaryRestrictions: [],
            weekStartDay: 1,
            timezone: "America/New_York",
          },
        });
      })
    );

    renderSection();
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /replace/i }));
    await user.type(screen.getByLabelText(/new api key/i), "sk-brand-new-key-9999");
    await user.click(screen.getByRole("button", { name: /save ai settings/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect((capturedBody as Record<string, unknown>).apiKey).toBe("sk-brand-new-key-9999");
  });

  it("rejects a model id with invalid characters before saving, without calling the API", async () => {
    const user = userEvent.setup();
    let putCalled = false;
    server.use(
      http.put(`${API_BASE}/api/settings/llm`, () => {
        putCalled = true;
        return HttpResponse.json(
          { success: false, error: "should not be called" },
          { status: 400 }
        );
      })
    );

    renderSection();
    await waitForLoaded();
    const modelInput = screen.getByLabelText(/^model$/i);
    await user.clear(modelInput);
    await user.type(modelInput, "bad model!!");
    await user.click(screen.getByRole("button", { name: /save ai settings/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/letters, numbers/i);
    expect(putCalled).toBe(false);
  });

  it("Test Connection succeeds and reports the result via role=status", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_BASE}/api/settings/llm/test`, () =>
        HttpResponse.json({ success: true, data: { ok: true, latencyMs: 250 } })
      )
    );
    renderSection();
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    // role="status" doesn't take a name from its text content (per ARIA, "status"
    // only takes a name from author-supplied aria-label/aria-labelledby), so this
    // finds it by role alone and asserts on its text.
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/connected successfully/i);
    expect(status).toHaveTextContent("250ms");
  });

  it.each([
    ["invalid_key", /rejected by the provider/i],
    ["rate_limited", /rate-limiting/i],
    ["provider_unavailable", /unavailable/i],
    ["timeout", /timed out/i],
  ] as const)("Test Connection surfaces a distinct message for %s", async (errorCode, expected) => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_BASE}/api/settings/llm/test`, () =>
        HttpResponse.json({
          success: true,
          data: { ok: false, latencyMs: 10, error: errorCode },
        })
      )
    );
    renderSection();
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(expected);
  });

  it("changing provider clears the model field and warns that a key is already stored", async () => {
    const user = userEvent.setup();
    renderSection();
    await waitForLoaded();

    const modelInput = screen.getByLabelText(/^model$/i) as HTMLInputElement;
    expect(modelInput.value).toBe("gpt-4o-mini");

    await user.click(screen.getByRole("combobox", { name: /provider/i }));
    const option = await screen.findByRole("option", { name: /anthropic/i });
    await user.click(option);

    expect(modelInput.value).toBe("");
    expect(
      await screen.findByText(/stored key was saved for a different provider/i)
    ).toBeInTheDocument();
  });

  it("allergies and dietary restrictions round-trip: add, remove, and submit", async () => {
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put(`${API_BASE}/api/settings/llm`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: {
            provider: "openai",
            model: "gpt-4o-mini",
            keyConfigured: true,
            keyLast4: "7f2c",
            defaultServings: 4,
            allergies: capturedBody.allergies ?? [],
            dietaryRestrictions: capturedBody.dietaryRestrictions ?? [],
            weekStartDay: 1,
            timezone: "America/New_York",
          },
        });
      })
    );

    renderSection();
    await waitForLoaded();

    const allergyInput = screen.getByLabelText(/^allergies$/i);
    await user.type(allergyInput, "Peanuts{Enter}");
    await user.type(allergyInput, "Shellfish{Enter}");
    expect(screen.getByText("Peanuts")).toBeInTheDocument();
    expect(screen.getByText("Shellfish")).toBeInTheDocument();

    // Remove one before submitting.
    await user.click(screen.getByRole("button", { name: "Remove Shellfish" }));
    expect(screen.queryByText("Shellfish")).not.toBeInTheDocument();

    const dietInput = screen.getByLabelText(/^dietary restrictions$/i);
    await user.type(dietInput, "Vegetarian{Enter}");

    await user.click(screen.getByRole("button", { name: /save ai settings/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect((capturedBody as Record<string, unknown>).allergies).toEqual(["Peanuts"]);
    expect((capturedBody as Record<string, unknown>).dietaryRestrictions).toEqual(["Vegetarian"]);
  });

  it("Test Connection works before saving, using the in-progress unsaved key", async () => {
    const user = userEvent.setup();
    server.use(
      // Not configured yet — no stored key.
      http.get(`${API_BASE}/api/settings/llm`, () =>
        HttpResponse.json({
          success: true,
          data: {
            provider: null,
            model: null,
            keyConfigured: false,
            keyLast4: null,
            defaultServings: 2,
            allergies: [],
            dietaryRestrictions: [],
            weekStartDay: 1,
            timezone: "America/New_York",
          },
        })
      ),
      http.post(`${API_BASE}/api/settings/llm/test`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.apiKey).toBe("sk-unsaved-key");
        return HttpResponse.json({ success: true, data: { ok: true, latencyMs: 99 } });
      })
    );

    renderSection();
    await waitForLoaded("");

    await user.click(screen.getByRole("combobox", { name: /provider/i }));
    await user.click(await screen.findByRole("option", { name: /openai/i }));
    await user.type(screen.getByLabelText(/^model$/i), "gpt-4o-mini");
    await user.click(screen.getByRole("button", { name: /add api key/i }));
    await user.type(screen.getByLabelText(/^api key$/i), "sk-unsaved-key");

    await user.click(screen.getByRole("button", { name: /test connection/i }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/connected successfully/i);
  }, 10000); // several sequential Select/typing interactions — more headroom under load

  // ---------------------------------------------------------------------------------
  // Live model catalogue (plan §5.6) — replaces the hardcoded MODEL_SUGGESTIONS list.
  // The list is suggestions only: free text always wins, and a fetch failure must
  // never block the form.
  // ---------------------------------------------------------------------------------

  it("renders live model suggestions as selectable chips and a datalist, once loaded", async () => {
    renderSection();
    await waitForLoaded();

    // Default handler (src/test/mocks/handlers.ts) returns ["gpt-5.4-mini", "gpt-4o-mini"]
    // for provider=openai.
    const chip = await screen.findByRole("button", { name: "gpt-5.4-mini" });
    expect(chip).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gpt-4o-mini" })).toBeInTheDocument();

    const modelInput = screen.getByLabelText(/^model$/i) as HTMLInputElement;
    const user = userEvent.setup();
    await user.click(chip);
    expect(modelInput.value).toBe("gpt-5.4-mini");
  });

  it("still accepts and saves a free-text model id that the live catalogue does NOT list", async () => {
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put(`${API_BASE}/api/settings/llm`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: {
            provider: "openai",
            model: capturedBody.model,
            keyConfigured: true,
            keyLast4: "7f2c",
            defaultServings: 4,
            allergies: [],
            dietaryRestrictions: [],
            weekStartDay: 1,
            timezone: "America/New_York",
            envDefaults: { provider: "openai", model: "gpt-4o-mini" },
          },
        });
      })
    );

    renderSection();
    await waitForLoaded();
    // Wait for the live list to actually resolve first, so clearing/typing afterward
    // isn't racing a suggestions fetch that hasn't landed yet.
    await screen.findByRole("button", { name: "gpt-5.4-mini" });

    const modelInput = screen.getByLabelText(/^model$/i);
    await user.clear(modelInput);
    await user.type(modelInput, "gpt-6-nonexistent-preview");
    await user.click(screen.getByRole("button", { name: /save ai settings/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect((capturedBody as Record<string, unknown>).model).toBe("gpt-6-nonexistent-preview");
  });

  it("pre-fills provider and model from envDefaults when the household has never configured AI settings", async () => {
    server.use(
      http.get(`${API_BASE}/api/settings/llm`, () =>
        HttpResponse.json({
          success: true,
          data: {
            provider: null,
            model: null,
            keyConfigured: false,
            keyLast4: null,
            defaultServings: 2,
            allergies: [],
            dietaryRestrictions: [],
            weekStartDay: 1,
            timezone: "America/New_York",
            envDefaults: { provider: "anthropic", model: "claude-sonnet-4-6" },
          },
        })
      )
    );

    renderSection();
    await waitForLoaded("claude-sonnet-4-6");
    expect(screen.getByRole("combobox", { name: /provider/i })).toHaveTextContent(/anthropic/i);
  });

  // -------------------------------------------------------------------------------
  // envDefaults.unsupportedProvider (item 4): when the operator's container-wide
  // LLM_PROVIDER is set to something meal planning doesn't support (groq/ollama/a
  // typo), envDefaults.provider/model come back null with nothing to seed the form
  // with — same top-level shape as "operator never configured anything". Rather than
  // render an unexplained blank form in both cases, the API also returns
  // `unsupportedProvider` naming the operator's actual value, and the form must
  // explain instead of silently misrepresenting the config as "nothing set".
  // -------------------------------------------------------------------------------
  it("explains an unsupported operator provider (envDefaults.unsupportedProvider) instead of silently rendering an empty form", async () => {
    server.use(
      http.get(`${API_BASE}/api/settings/llm`, () =>
        HttpResponse.json({
          success: true,
          data: {
            provider: null,
            model: null,
            keyConfigured: false,
            keyLast4: null,
            defaultServings: 2,
            allergies: [],
            dietaryRestrictions: [],
            weekStartDay: 1,
            timezone: "America/New_York",
            envDefaults: { provider: null, model: null, unsupportedProvider: "groq" },
          },
        })
      )
    );

    renderSection();
    await screen.findByRole("combobox", { name: /provider/i });
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/groq/i);
    expect(notice.textContent).toMatch(/isn.t supported for meal planning/i);
    // The form itself must still be genuinely empty — never a misreported default.
    expect(screen.getByRole("combobox", { name: /provider/i })).toHaveTextContent(
      /choose a provider/i
    );
  });

  it("shows no unsupported-provider notice when the household already has its own saved provider, even if envDefaults.unsupportedProvider is set (stale/irrelevant once the household has configured itself)", async () => {
    server.use(
      http.get(`${API_BASE}/api/settings/llm`, () =>
        HttpResponse.json({
          success: true,
          data: {
            provider: "anthropic",
            model: "claude-haiku-4-5-20251001",
            keyConfigured: true,
            keyLast4: "7f2c",
            defaultServings: 2,
            allergies: [],
            dietaryRestrictions: [],
            weekStartDay: 1,
            timezone: "America/New_York",
            envDefaults: { provider: null, model: null, unsupportedProvider: "ollama" },
          },
        })
      )
    );

    renderSection();
    await waitForLoaded("claude-haiku-4-5-20251001");
    expect(screen.queryByText(/ollama/i)).not.toBeInTheDocument();
  });

  it("shows no unsupported-provider notice in the ordinary first-run case (unsupportedProvider null)", async () => {
    renderSection();
    await waitForLoaded();
    expect(screen.queryByText(/isn't supported for meal planning/i)).not.toBeInTheDocument();
  });

  it("degrades silently to free-text entry when the model list fetch fails — no blocking error", async () => {
    server.use(
      http.get(`${API_BASE}/api/settings/llm/models`, () =>
        HttpResponse.json({ success: false, error: "boom" }, { status: 500 })
      )
    );
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put(`${API_BASE}/api/settings/llm`, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: {
            provider: "openai",
            model: capturedBody.model,
            keyConfigured: true,
            keyLast4: "7f2c",
            defaultServings: 4,
            allergies: [],
            dietaryRestrictions: [],
            weekStartDay: 1,
            timezone: "America/New_York",
            envDefaults: { provider: "openai", model: "gpt-4o-mini" },
          },
        });
      })
    );

    const user = userEvent.setup();
    renderSection();
    await waitForLoaded();

    // The failed fetch must never surface as a blocking alert/status, and must never
    // prevent typing a free-text model or saving.
    const modelInput = screen.getByLabelText(/^model$/i);
    await user.clear(modelInput);
    await user.type(modelInput, "gpt-4o-mini-custom");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save ai settings/i }));
    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect((capturedBody as Record<string, unknown>).model).toBe("gpt-4o-mini-custom");
  });

  // ---------------------------------------------------------------------------------
  // OCR vision-model field — visually/behaviourally aligned with the chat model field
  // above, but with its own null-vs-undefined clear/no-change contract (spec §3).
  // ---------------------------------------------------------------------------------

  describe("vision model (receipt OCR) field", () => {
    function llmSettingsFixture(overrides: Record<string, unknown> = {}) {
      return {
        provider: "openai",
        model: "gpt-4o-mini",
        visionModel: null,
        keyConfigured: true,
        keyLast4: "7f2c",
        defaultServings: 4,
        allergies: [],
        dietaryRestrictions: [],
        weekStartDay: 1,
        timezone: "America/New_York",
        envDefaults: { provider: "openai", model: "gpt-4o-mini", visionModel: "gpt-4o-mini" },
        ...overrides,
      };
    }

    it("pre-fills from a saved visionModel", async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/llm`, () =>
          HttpResponse.json({
            success: true,
            data: llmSettingsFixture({ visionModel: "gpt-4o" }),
          })
        )
      );

      renderSection();
      await waitForLoaded();
      expect(
        (screen.getByRole("combobox", { name: /vision model/i }) as HTMLInputElement).value
      ).toBe("gpt-4o");
    });

    it("shows the envDefaults.visionModel fallback affordance when no override is saved", async () => {
      // Default handler (src/test/mocks/handlers.ts) already returns visionModel: null
      // and envDefaults.visionModel: "gpt-4o-mini".
      renderSection();
      await waitForLoaded();

      expect(
        (screen.getByRole("combobox", { name: /vision model/i }) as HTMLInputElement).value
      ).toBe("");
      expect(screen.getByText(/leave blank to use the default: gpt-4o-mini/i)).toBeInTheDocument();
    });

    it("accepts and saves a free-text vision model id not in the live catalogue", async () => {
      const user = userEvent.setup();
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.put(`${API_BASE}/api/settings/llm`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            success: true,
            data: llmSettingsFixture({ visionModel: capturedBody.visionModel ?? null }),
          });
        })
      );

      renderSection();
      await waitForLoaded();
      await user.type(
        screen.getByRole("combobox", { name: /vision model/i }),
        "gpt-6-vision-preview"
      );
      await user.click(screen.getByRole("button", { name: /save ai settings/i }));

      await waitFor(() => expect(capturedBody).not.toBeNull());
      expect((capturedBody as Record<string, unknown>).visionModel).toBe("gpt-6-vision-preview");
    });

    it("clearing a previously-saved vision model sends explicit visionModel: null", async () => {
      const user = userEvent.setup();
      server.use(
        http.get(`${API_BASE}/api/settings/llm`, () =>
          HttpResponse.json({
            success: true,
            data: llmSettingsFixture({ visionModel: "gpt-4o" }),
          })
        )
      );
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.put(`${API_BASE}/api/settings/llm`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            success: true,
            data: llmSettingsFixture({ visionModel: null }),
          });
        })
      );

      renderSection();
      await waitForLoaded();
      const visionInput = screen.getByRole("combobox", {
        name: /vision model/i,
      }) as HTMLInputElement;
      await waitFor(() => expect(visionInput.value).toBe("gpt-4o"));

      await user.clear(visionInput);
      await user.click(screen.getByRole("button", { name: /save ai settings/i }));

      await waitFor(() => expect(capturedBody).not.toBeNull());
      // Explicit null (clear back to env/default) — NOT undefined (no change), NOT "".
      expect((capturedBody as Record<string, unknown>).visionModel).toBeNull();
    });

    it("submitting without touching the vision model field sends no visionModel key at all", async () => {
      const user = userEvent.setup();
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.put(`${API_BASE}/api/settings/llm`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ success: true, data: llmSettingsFixture() });
        })
      );

      renderSection();
      await waitForLoaded();
      await user.click(screen.getByRole("button", { name: /save ai settings/i }));

      await waitFor(() => expect(capturedBody).not.toBeNull());
      expect("visionModel" in (capturedBody as Record<string, unknown>)).toBe(false);
    });

    it("rejects a vision model id with invalid characters before saving, without calling the API", async () => {
      const user = userEvent.setup();
      let putCalled = false;
      server.use(
        http.put(`${API_BASE}/api/settings/llm`, () => {
          putCalled = true;
          return HttpResponse.json(
            { success: false, error: "should not be called" },
            { status: 400 }
          );
        })
      );

      renderSection();
      await waitForLoaded();
      await user.type(screen.getByRole("combobox", { name: /vision model/i }), "bad vision!!");
      await user.click(screen.getByRole("button", { name: /save ai settings/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/letters, numbers/i);
      expect(putCalled).toBe(false);
    });

    it("clicking a suggestion chip populates the vision model field", async () => {
      renderSection();
      await waitForLoaded();

      // Default handler (src/test/mocks/handlers.ts) returns ["gpt-5.4-mini", "gpt-4o-mini"]
      // for provider=openai — reusing the SAME live catalogue query as the chat model
      // field, but the chip's accessible name is distinct ("Use X as vision model") so
      // it can't collide with the chat model's identically-labeled chip in queries.
      const chip = await screen.findByRole("button", { name: "Use gpt-5.4-mini as vision model" });
      const user = userEvent.setup();
      await user.click(chip);

      expect(
        (screen.getByRole("combobox", { name: /vision model/i }) as HTMLInputElement).value
      ).toBe("gpt-5.4-mini");
    });
  });
});
