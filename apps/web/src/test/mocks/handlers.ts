import { http, HttpResponse } from "msw";

// Vitest jsdom defaults to http://localhost:3000. fetchApi uses relative paths
// which resolve against the test origin, so handlers must match that base.
const API_BASE = "http://localhost:3000";

type ItemBody = {
  name?: string;
  brand?: string;
  category?: string;
  location?: string;
  quantity?: number;
  unit?: string;
  barcodeUpc?: string;
  expirationDate?: string | null;
  notes?: string | null;
};

type HouseholdBody = {
  name?: string;
};

type AuthBody = {
  email?: string;
  password?: string;
  name?: string;
};

export const handlers = [
  // Items endpoints
  http.get(`${API_BASE}/api/items`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        items: [
          {
            id: "1",
            householdId: "household-1",
            name: "Milk",
            brand: "Great Value",
            category: "Dairy",
            location: "fridge",
            quantity: 1,
            unit: "gallon",
            barcodeUpc: "041220000000",
            expirationDate: "2024-12-31",
            expirationEstimated: false,
            addedBy: "user-1",
            addedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            notes: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    });
  }),

  http.get(`${API_BASE}/api/items/:id`, ({ params }) => {
    const { id } = params;
    return HttpResponse.json({
      success: true,
      data: {
        id,
        householdId: "household-1",
        name: "Milk",
        brand: "Great Value",
        category: "Dairy",
        location: "fridge",
        quantity: 1,
        unit: "gallon",
        barcodeUpc: "041220000000",
        expirationDate: "2024-12-31",
        expirationEstimated: false,
        addedBy: "user-1",
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        notes: null,
      },
    });
  }),

  http.post(`${API_BASE}/api/items`, async ({ request }) => {
    const body = (await request.json()) as ItemBody;
    return HttpResponse.json(
      {
        success: true,
        data: {
          id: "new-item-id",
          householdId: "household-1",
          ...body,
          expirationEstimated: false,
          addedBy: "user-1",
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  }),

  http.patch(`${API_BASE}/api/items/:id`, async ({ params, request }) => {
    const { id } = params;
    const body = (await request.json()) as ItemBody;
    return HttpResponse.json({
      success: true,
      data: {
        id,
        householdId: "household-1",
        name: "Milk",
        brand: "Great Value",
        category: "Dairy",
        location: "fridge",
        quantity: 1,
        unit: "gallon",
        ...body,
        expirationEstimated: false,
        addedBy: "user-1",
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  http.delete(`${API_BASE}/api/items/:id`, () => {
    return HttpResponse.json({ success: true, data: null });
  }),

  // Households endpoints
  http.post(`${API_BASE}/api/households`, async ({ request }) => {
    const body = (await request.json()) as HouseholdBody;
    return HttpResponse.json(
      {
        success: true,
        data: {
          id: "new-household-id",
          name: body.name,
          inviteCode: "ABC12345",
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  }),

  http.get(`${API_BASE}/api/households/me`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        id: "household-1",
        name: "Smith Family",
        inviteCode: "ABC12345",
        createdAt: new Date().toISOString(),
      },
    });
  }),

  http.post(`${API_BASE}/api/households/join`, async ({ request }) => {
    const body = (await request.json()) as { inviteCode?: string };
    if (body.inviteCode === "ABC12345") {
      return HttpResponse.json({
        success: true,
        data: {
          id: "household-1",
          name: "Smith Family",
          inviteCode: "ABC12345",
          createdAt: new Date().toISOString(),
        },
      });
    }
    return HttpResponse.json({ success: false, error: "Invalid invite code" }, { status: 403 });
  }),

  // Barcode endpoints
  http.get(`${API_BASE}/api/barcode/:barcode`, ({ params }) => {
    const { barcode } = params;
    if (barcode === "999999999999") {
      return HttpResponse.json({ success: false, error: "Product not found" }, { status: 404 });
    }
    return HttpResponse.json({
      success: true,
      data: {
        name: "Coca-Cola Classic",
        brand: "Coca-Cola",
        category: "Beverages",
        imageUrl: "https://example.com/coke.jpg",
        estimatedExpirationDays: 7,
        estimatedExpirationLabel: "~1 week",
      },
    });
  }),

  // Receipt endpoints
  http.post(`${API_BASE}/api/receipt`, async () => {
    return HttpResponse.json({
      success: true,
      data: {
        storeName: "Walmart",
        lineItems: [
          {
            raw: "GV MLK HLF GL",
            decoded: "Great Value Milk Half Gallon",
            confidence: 0.95,
            quantity: 1,
            price: 3.99,
          },
          {
            raw: "BNNNS ORGNIC",
            decoded: "Organic Bananas",
            confidence: 0.88,
            quantity: 1,
            price: 2.49,
          },
        ],
        total: 6.48,
      },
    });
  }),

  // Auth endpoints (Better Auth)
  http.post(`${API_BASE}/api/auth/sign-in/email`, async () => {
    return HttpResponse.json({
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
      },
      token: "mock-jwt-token",
    });
  }),

  http.post(`${API_BASE}/api/auth/sign-up/email`, async ({ request }) => {
    const body = (await request.json()) as AuthBody;
    return HttpResponse.json(
      {
        user: {
          id: "new-user-id",
          email: body.email,
          name: body.name,
        },
        token: "mock-jwt-token",
      },
      { status: 201 }
    );
  }),

  http.get(`${API_BASE}/api/auth/session`, () => {
    return HttpResponse.json({
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
      },
    });
  }),

  http.post(`${API_BASE}/api/auth/sign-out`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Config
  http.get(`${API_BASE}/api/config`, () => {
    return HttpResponse.json({ signupEnabled: true });
  }),

  // Shopping list
  http.get(`${API_BASE}/api/shopping-list`, () => {
    return HttpResponse.json({ success: true, data: [] });
  }),

  http.post(`${API_BASE}/api/shopping-list`, async ({ request }) => {
    const body = (await request.json()) as {
      name?: string;
      brand?: string;
      category?: string;
      unit?: string;
      suggestedQty?: number;
      sourceItemId?: string;
    };
    return HttpResponse.json(
      {
        success: true,
        data: {
          id: "sl-new",
          householdId: "household-1",
          name: body.name ?? "",
          brand: body.brand ?? null,
          category: body.category ?? null,
          unit: body.unit ?? null,
          suggestedQty: body.suggestedQty ?? 1,
          sourceItemId: body.sourceItemId ?? null,
          status: "pending",
          addedBy: "user-1",
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  }),

  http.delete(`${API_BASE}/api/shopping-list/:id`, () => {
    return HttpResponse.json({ success: true, data: null });
  }),

  http.patch(`${API_BASE}/api/shopping-list/:id`, ({ params }) => {
    const { id } = params;
    return HttpResponse.json({
      success: true,
      data: {
        id,
        householdId: "household-1",
        name: "Milk",
        brand: null,
        category: null,
        unit: null,
        suggestedQty: 1,
        sourceItemId: null,
        status: "purchased",
        addedBy: "user-1",
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  // Houses
  http.get(`${API_BASE}/api/houses`, () => {
    return HttpResponse.json({
      success: true,
      data: [
        {
          id: "house-1",
          householdId: "household-1",
          name: "Main",
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }),

  // ---------------------------------------------------------------------------------
  // Meal planning (docs/plans/meal-planning.md §4.4). Every new endpoint needs a
  // handler here — setup.ts uses onUnhandledRequest: "error".
  // ---------------------------------------------------------------------------------

  // LLM / AI settings
  http.get(`${API_BASE}/api/settings/llm`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        provider: "openai",
        model: "gpt-4o-mini",
        // No household-saved OCR override by default — tests that need a pre-filled
        // value override this handler with `server.use(...)`.
        visionModel: null,
        keyConfigured: true,
        keyLast4: "7f2c",
        defaultServings: 4,
        allergies: [],
        dietaryRestrictions: [],
        weekStartDay: 1,
        timezone: "America/New_York",
        envDefaults: { provider: "openai", model: "gpt-4o-mini", visionModel: "gpt-4o-mini" },
      },
    });
  }),

  http.put(`${API_BASE}/api/settings/llm`, async ({ request }) => {
    const body = (await request.json()) as {
      provider?: string;
      model?: string;
      // `visionModel` follows the same omitted/null/string precedent as `apiKey`:
      // the key's absence (vs. `null` vs. a string) is significant, so it's read via
      // `"visionModel" in body` below rather than `body.visionModel ?? ...`, which
      // could not otherwise distinguish "omitted" from "explicitly null".
      visionModel?: string | null;
      defaultServings?: number;
      allergies?: string[];
      dietaryRestrictions?: string[];
      weekStartDay?: number;
      timezone?: string;
    };
    return HttpResponse.json({
      success: true,
      data: {
        provider: body.provider ?? "openai",
        model: body.model ?? "gpt-4o-mini",
        visionModel: "visionModel" in body ? body.visionModel : null,
        keyConfigured: true,
        keyLast4: "7f2c",
        defaultServings: body.defaultServings ?? 4,
        allergies: body.allergies ?? [],
        dietaryRestrictions: body.dietaryRestrictions ?? [],
        weekStartDay: body.weekStartDay ?? 1,
        timezone: body.timezone ?? "America/New_York",
        envDefaults: { provider: "openai", model: "gpt-4o-mini", visionModel: "gpt-4o-mini" },
      },
    });
  }),

  http.post(`${API_BASE}/api/settings/llm/test`, () => {
    return HttpResponse.json({ success: true, data: { ok: true, latencyMs: 120 } });
  }),

  // Live model catalogue (plan §5.6) — default handler returns a small suggestion list
  // per provider; individual tests override this to exercise loading/empty/error states.
  http.get(`${API_BASE}/api/settings/llm/models`, ({ request }) => {
    const provider = new URL(request.url).searchParams.get("provider") ?? "openai";
    const modelsByProvider: Record<string, string[]> = {
      openai: ["gpt-5.4-mini", "gpt-4o-mini"],
      anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
      openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.7-sonnet"],
    };
    return HttpResponse.json({
      success: true,
      data: { provider, models: modelsByProvider[provider] ?? [], reason: null },
    });
  }),

  // Meal plan prompts CRUD — registered before /api/meal-plans/:id so "/prompts"
  // never gets swallowed by a :id param match, mirroring the real route mount order.
  http.get(`${API_BASE}/api/meal-plans/prompts`, () => {
    return HttpResponse.json({
      success: true,
      data: [
        {
          id: "prompt-1",
          householdId: "household-1",
          name: "Default",
          body: "Use {{PANTRY}} and prefer quick weeknight meals.",
          isDefault: true,
          updatedBy: "user-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
  }),

  http.post(`${API_BASE}/api/meal-plans/prompts`, async ({ request }) => {
    const body = (await request.json()) as { name?: string; body?: string; isDefault?: boolean };
    return HttpResponse.json(
      {
        success: true,
        data: {
          id: "prompt-new",
          householdId: "household-1",
          name: body.name ?? "",
          body: body.body ?? "",
          isDefault: body.isDefault ?? false,
          updatedBy: "user-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  }),

  http.patch(`${API_BASE}/api/meal-plans/prompts/:promptId`, async ({ params, request }) => {
    const { promptId } = params;
    const body = (await request.json()) as { name?: string; body?: string; isDefault?: boolean };
    return HttpResponse.json({
      success: true,
      data: {
        id: promptId,
        householdId: "household-1",
        name: body.name ?? "Default",
        body: body.body ?? "Use {{PANTRY}}.",
        isDefault: body.isDefault ?? false,
        updatedBy: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }),

  http.delete(`${API_BASE}/api/meal-plans/prompts/:promptId`, () => {
    return HttpResponse.json({ success: true, data: null });
  }),

  // Meal plans
  http.post(`${API_BASE}/api/meal-plans`, () => {
    return HttpResponse.json(
      { success: true, data: { id: "plan-1", status: "queued" } },
      { status: 202 }
    );
  }),

  http.get(`${API_BASE}/api/meal-plans`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        items: [
          {
            id: "plan-1",
            householdId: "household-1",
            startDate: "2026-09-08",
            dayCount: 7,
            mode: "balanced",
            includeExpired: false,
            status: "ready",
            progressDone: 7,
            progressTotal: 7,
            promptId: null,
            providerSnapshot: "openai",
            modelSnapshot: "gpt-4o-mini",
            inputTokens: 1200,
            outputTokens: 3400,
            generationMs: 45000,
            priorityCoverage: 0.8,
            errorCode: null,
            errorMessage: null,
            requestedBy: "user-1",
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        ],
        page: 1,
        pageSize: 20,
      },
    });
  }),

  http.get(`${API_BASE}/api/meal-plans/:id`, ({ params }) => {
    const { id } = params;
    return HttpResponse.json({
      success: true,
      data: {
        id,
        householdId: "household-1",
        startDate: "2026-09-08",
        dayCount: 1,
        mode: "balanced",
        includeExpired: false,
        status: "ready",
        progressDone: 1,
        progressTotal: 1,
        promptId: null,
        providerSnapshot: "openai",
        modelSnapshot: "gpt-4o-mini",
        inputTokens: 1200,
        outputTokens: 3400,
        generationMs: 45000,
        priorityCoverage: 0.8,
        errorCode: null,
        errorMessage: null,
        requestedBy: "user-1",
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        days: [
          {
            id: "day-1",
            householdId: "household-1",
            planId: id,
            dayIndex: 0,
            date: "2026-09-08",
            meals: [
              {
                id: "meal-1",
                householdId: "household-1",
                planId: id,
                dayId: "day-1",
                slot: "dinner",
                sortOrder: 0,
                title: "Onion Soup",
                summary: "A simple soup.",
                servings: 4,
                prepMinutes: 10,
                cookMinutes: 30,
                instructions: ["Chop onions.", "Simmer 30 minutes."],
                detailStatus: "ready",
                detailError: null,
                ingredients: [
                  {
                    id: "ing-1",
                    householdId: "household-1",
                    mealId: "meal-1",
                    rawText: "3 onions",
                    nameNormalized: "onion",
                    quantity: 3,
                    unit: "unit",
                    preparation: "chopped",
                    optional: false,
                    source: "pantry",
                    sourceOverridden: false,
                    matchedItemId: null,
                    shoppingListItemId: null,
                    matchConfidence: null,
                    sortOrder: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  }),

  http.post(`${API_BASE}/api/meal-plans/:id/cancel`, ({ params }) => {
    const { id } = params;
    return HttpResponse.json({
      success: true,
      data: {
        id,
        householdId: "household-1",
        startDate: "2026-09-08",
        dayCount: 1,
        mode: "balanced",
        includeExpired: false,
        status: "cancelled",
        progressDone: 0,
        progressTotal: 1,
        promptId: null,
        providerSnapshot: "openai",
        modelSnapshot: "gpt-4o-mini",
        inputTokens: null,
        outputTokens: null,
        generationMs: null,
        priorityCoverage: null,
        errorCode: null,
        errorMessage: null,
        requestedBy: "user-1",
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    });
  }),

  http.post(`${API_BASE}/api/meal-plans/:id/meals/:mealId/regenerate`, ({ params }) => {
    const { mealId } = params;
    return HttpResponse.json(
      { success: true, data: { id: mealId, detailStatus: "pending" } },
      { status: 202 }
    );
  }),

  http.patch(`${API_BASE}/api/meal-plans/:id/ingredients/:ingId`, async ({ params, request }) => {
    const { ingId } = params;
    const body = (await request.json()) as { source?: string };
    return HttpResponse.json({
      success: true,
      data: {
        id: ingId,
        householdId: "household-1",
        mealId: "meal-1",
        rawText: "3 onions",
        nameNormalized: "onion",
        quantity: 3,
        unit: "unit",
        preparation: "chopped",
        optional: false,
        source: body.source ?? "pantry",
        sourceOverridden: true,
        matchedItemId: null,
        shoppingListItemId: null,
        matchConfidence: null,
        sortOrder: 0,
      },
    });
  }),

  http.get(`${API_BASE}/api/meal-plans/:id/shopping`, ({ params }) => {
    const { id } = params;
    return HttpResponse.json({
      success: true,
      data: {
        planId: id,
        items: [
          {
            nameNormalized: "onion",
            unit: "unit",
            quantityLabel: "3 unit",
            state: "must_buy",
            ingredientIds: ["ing-1"],
            usedOn: [{ dayIndex: 0, recipeId: "meal-1", recipeTitle: "Onion Soup" }],
            alreadyCommitted: false,
          },
        ],
      },
    });
  }),

  http.post(`${API_BASE}/api/meal-plans/:id/shopping/commit`, () => {
    return HttpResponse.json({ success: true, data: { created: 1 } });
  }),

  http.delete(`${API_BASE}/api/meal-plans/:id`, () => {
    return HttpResponse.json({ success: true, data: null });
  }),
];
