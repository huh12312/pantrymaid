import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse, delay } from "msw";
import { server } from "../mocks/server";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { useAuth } from "@/lib/auth";
import { useHouseStore } from "@/lib/houseStore";
import { useMealPlanControlsStore } from "@/lib/mealPlanControls";
import { registerUnauthorizedCallback } from "@/lib/api";
import type { MealPlanDetail, MealPlanMealDetail, MealPlanSummary } from "@/lib/api";
import MealPlanPage from "@/pages/MealPlanPage";

const API_BASE = "http://localhost:3000";
const mockUser = { id: "user-1", email: "test@example.com", name: "Test User" };

function makeMeal(overrides: Partial<MealPlanMealDetail> = {}): MealPlanMealDetail {
  return {
    id: "meal-1",
    householdId: "household-1",
    planId: "plan-1",
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
    ingredients: [],
    ...overrides,
  };
}

function makePlan(overrides: Partial<MealPlanDetail> = {}): MealPlanDetail {
  return {
    id: "plan-1",
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
    inputTokens: 100,
    outputTokens: 200,
    generationMs: 1000,
    priorityCoverage: null,
    errorCode: null,
    errorMessage: null,
    requestedBy: "user-1",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    days: [
      {
        id: "day-1",
        householdId: "household-1",
        planId: "plan-1",
        dayIndex: 0,
        date: "2026-09-08",
        meals: [makeMeal()],
      },
    ],
    ...overrides,
  } as MealPlanDetail;
}

function toSummary(plan: MealPlanDetail): MealPlanSummary {
  const { days: _days, ...summary } = plan;
  return summary as MealPlanSummary;
}

/** Registers matching /api/meal-plans (list) and /api/meal-plans/:id handlers for one plan. */
function mockPlan(plan: MealPlanDetail) {
  server.use(
    http.get(`${API_BASE}/api/meal-plans`, () => {
      return HttpResponse.json({
        success: true,
        data: { items: [toSummary(plan)], page: 1, pageSize: 1 },
      });
    }),
    http.get(`${API_BASE}/api/meal-plans/${plan.id}`, () => {
      return HttpResponse.json({ success: true, data: plan });
    })
  );
}

function mockNoPlan() {
  server.use(
    http.get(`${API_BASE}/api/meal-plans`, () => {
      return HttpResponse.json({ success: true, data: { items: [], page: 1, pageSize: 1 } });
    })
  );
}

function mockLlmSettings(overrides: { keyConfigured?: boolean } = {}) {
  server.use(
    http.get(`${API_BASE}/api/settings/llm`, () => {
      return HttpResponse.json({
        success: true,
        data: {
          provider: "openai",
          model: "gpt-4o-mini",
          keyConfigured: overrides.keyConfigured ?? true,
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
}

function mockItems(items: Array<{ expirationDate: string | null }>) {
  server.use(
    http.get(`${API_BASE}/api/items`, () => {
      return HttpResponse.json({
        success: true,
        data: {
          items: items.map((item, i) => ({
            id: `item-${i}`,
            householdId: "household-1",
            name: `Item ${i}`,
            brand: null,
            category: null,
            location: "pantry",
            quantity: 1,
            unit: "unit",
            barcodeUpc: null,
            expirationDate: item.expirationDate,
            expirationEstimated: false,
            addedBy: "user-1",
            addedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            notes: null,
          })),
          total: items.length,
          page: 1,
          pageSize: 50,
        },
      });
    })
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}</span>;
}

function renderMealPlanPage(initialEntry = "/meal-plan") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ThemeProvider>
          <LocationProbe />
          <Routes>
            <Route path="/meal-plan" element={<MealPlanPage />} />
            <Route path="/meal-plan/recipe/:recipeId" element={<MealPlanPage />} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("MealPlanPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuth.setState({ user: mockUser, isAuthenticated: true });
    useHouseStore.setState({ selectedHouseId: null });
    useMealPlanControlsStore.setState({
      slots: ["dinner"],
      mode: "balanced",
      includeExpired: false,
    });
    mockLlmSettings({ keyConfigured: true });
    mockItems([{ expirationDate: null }]);
  });

  afterEach(() => {
    registerUnauthorizedCallback(() => {});
  });

  it("renders each day of a ready plan from a fixture, with the day count in the sidebar's active nav", async () => {
    mockPlan(
      makePlan({
        dayCount: 2,
        days: [
          {
            id: "day-1",
            householdId: "household-1",
            planId: "plan-1",
            dayIndex: 0,
            date: "2026-09-08",
            meals: [makeMeal({ id: "meal-1", title: "Onion Soup" })],
          },
          {
            id: "day-2",
            householdId: "household-1",
            planId: "plan-1",
            dayIndex: 1,
            date: "2026-09-09",
            meals: [makeMeal({ id: "meal-2", title: "Tacos", dayId: "day-2" })],
          },
        ],
      })
    );

    renderMealPlanPage();

    expect(
      await screen.findByRole("heading", { level: 2, name: /tuesday, sep 8/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /wednesday, sep 9/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /onion soup/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /tacos/i })).toBeInTheDocument();

    // Sidebar's Meal Plan link is the active route.
    expect(screen.getByRole("link", { name: /meal plan/i })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("shows AiSetupPrompt with no generate button when no AI key is configured and no plan exists", async () => {
    mockLlmSettings({ keyConfigured: false });
    mockNoPlan();

    renderMealPlanPage();

    expect(await screen.findByRole("link", { name: /go to settings/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
  });

  it("shows MealPlanEmptyState with generate controls and a concrete preview when a key exists but no plan does", async () => {
    mockNoPlan();
    mockItems([{ expirationDate: null }, { expirationDate: null }]);

    renderMealPlanPage();

    expect(await screen.findByText(/plan your week/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate meal plan/i })).toBeEnabled();
    expect(await screen.findByText(/we'll use 2 pantry items/i)).toBeInTheDocument();
  });

  it("starting generation shows meal-denominated progress with aria-busy, and a second click issues no second POST", async () => {
    mockNoPlan();
    let postCount = 0;
    server.use(
      http.post(`${API_BASE}/api/meal-plans`, async () => {
        postCount += 1;
        await delay(30);
        return HttpResponse.json(
          { success: true, data: { id: "plan-new", status: "queued" } },
          { status: 202 }
        );
      }),
      http.get(`${API_BASE}/api/meal-plans/plan-new`, () => {
        return HttpResponse.json({
          success: true,
          data: makePlan({
            id: "plan-new",
            status: "generating_recipes",
            progressDone: 3,
            progressTotal: 7,
            days: [],
          }),
        });
      })
    );

    const user = userEvent.setup();
    renderMealPlanPage();

    const button = await screen.findByRole("button", { name: /generate meal plan/i });
    await user.click(button);
    await user.click(button);

    await waitFor(() => expect(screen.getByText(/3 of 7 meals ready/i)).toBeInTheDocument());
    expect(postCount).toBe(1);
  });

  it.each([
    ["invalid_api_key", /rejected the stored api key/i, true],
    ["provider_unavailable", /temporarily unavailable/i, false],
    ["unparseable_output", /couldn't be used/i, false],
    ["timeout", /timed out/i, false],
    ["interrupted", /interrupted by a server restart/i, false],
  ] as const)(
    "shows a distinct message for a failed plan with errorCode %s",
    async (code, matcher, hasSettingsLink) => {
      mockPlan(makePlan({ status: "failed", errorCode: code, errorMessage: null, days: [] }));

      renderMealPlanPage();

      expect(await screen.findByRole("alert")).toHaveTextContent(matcher);
      const settingsLink = screen.queryByRole("link", { name: /go to settings/i });
      if (hasSettingsLink) expect(settingsLink).toBeInTheDocument();
      else expect(settingsLink).not.toBeInTheDocument();
    }
  );

  it("a failed meal on an otherwise-ready plan shows an inline retry that keeps the rest of the plan", async () => {
    let regenerateCalls = 0;
    mockPlan(
      makePlan({
        days: [
          {
            id: "day-1",
            householdId: "household-1",
            planId: "plan-1",
            dayIndex: 0,
            date: "2026-09-08",
            meals: [
              makeMeal({ id: "meal-ok", title: "Good Meal" }),
              makeMeal({
                id: "meal-bad",
                title: "Broken Meal",
                slot: "lunch",
                detailStatus: "failed",
                detailError: "Model output was invalid.",
              }),
            ],
          },
        ],
      })
    );
    server.use(
      http.post(`${API_BASE}/api/meal-plans/plan-1/meals/meal-bad/regenerate`, () => {
        regenerateCalls += 1;
        return HttpResponse.json(
          { success: true, data: { id: "meal-bad", detailStatus: "pending" } },
          { status: 202 }
        );
      })
    );

    const user = userEvent.setup();
    renderMealPlanPage();

    expect(await screen.findByText("Good Meal")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/model output was invalid/i);
    await user.click(screen.getByRole("button", { name: /retry this recipe/i }));
    expect(regenerateCalls).toBe(1);
    // The healthy meal is untouched — partial results are kept.
    expect(screen.getByText("Good Meal")).toBeInTheDocument();
  });

  it("opens the recipe sheet via a deep link and shows the full recipe", async () => {
    mockPlan(makePlan());

    renderMealPlanPage("/meal-plan/recipe/meal-1");

    expect(
      await screen.findByRole("heading", { level: 2, name: /onion soup/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Chop onions.")).toBeInTheDocument();
  });

  it("closing the recipe sheet from a cold deep link returns to /meal-plan instead of exiting the app", async () => {
    mockPlan(makePlan());

    const user = userEvent.setup();
    renderMealPlanPage("/meal-plan/recipe/meal-1");

    expect(
      await screen.findByRole("heading", { level: 2, name: /onion soup/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/meal-plan/recipe/meal-1");

    await user.click(screen.getByRole("button", { name: /close/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location-probe")).toHaveTextContent("/meal-plan")
    );
    expect(screen.getByTestId("location-probe")).not.toHaveTextContent("/recipe/");
  });

  it("clicking a meal card opens the recipe route, and closing it returns to /meal-plan", async () => {
    mockPlan(makePlan());
    const user = userEvent.setup();
    renderMealPlanPage("/meal-plan");

    await user.click(await screen.findByRole("link", { name: /onion soup/i }));
    expect(
      await screen.findByRole("heading", { level: 2, name: /onion soup/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() =>
      expect(screen.getByTestId("location-probe")).toHaveTextContent("/meal-plan")
    );
  });

  it("the jump rail's aria-current tracks the day last jumped to", async () => {
    mockPlan(
      makePlan({
        dayCount: 2,
        days: [
          {
            id: "day-1",
            householdId: "household-1",
            planId: "plan-1",
            dayIndex: 0,
            date: "2026-09-08",
            meals: [makeMeal({ id: "meal-1" })],
          },
          {
            id: "day-2",
            householdId: "household-1",
            planId: "plan-1",
            dayIndex: 1,
            date: "2026-09-09",
            meals: [makeMeal({ id: "meal-2", dayId: "day-2" })],
          },
        ],
      })
    );

    const user = userEvent.setup();
    renderMealPlanPage();
    await screen.findByRole("heading", { level: 2, name: /tuesday, sep 8/i });

    const rail = screen.getByRole("navigation", { name: /jump to day/i });
    const dayButtons = within(rail).getAllByRole("button");
    expect(dayButtons).toHaveLength(2);

    await user.click(dayButtons[1] as HTMLElement);
    expect(dayButtons[1]).toHaveAttribute("aria-current", "true");
    expect(dayButtons[0]).not.toHaveAttribute("aria-current");
  });

  describe("the needs-purchase surface (plan §5.4)", () => {
    function planWithIngredients() {
      return makePlan({
        days: [
          {
            id: "day-1",
            householdId: "household-1",
            planId: "plan-1",
            dayIndex: 0,
            date: "2026-09-08",
            meals: [
              makeMeal({
                id: "meal-1",
                title: "Onion Soup",
                ingredients: [
                  {
                    id: "ing-1",
                    householdId: "household-1",
                    mealId: "meal-1",
                    rawText: "2 onions",
                    nameNormalized: "onion",
                    quantity: 2,
                    unit: "unit",
                    preparation: null,
                    optional: false,
                    source: "purchase",
                    sourceOverridden: false,
                    matchedItemId: null,
                    shoppingListItemId: null,
                    matchConfidence: null,
                    sortOrder: 0,
                  },
                  {
                    id: "ing-2",
                    householdId: "household-1",
                    mealId: "meal-1",
                    rawText: "1 tsp salt",
                    nameNormalized: "salt",
                    quantity: 1,
                    unit: "tsp",
                    preparation: null,
                    optional: false,
                    source: "staple",
                    sourceOverridden: false,
                    matchedItemId: null,
                    shoppingListItemId: null,
                    matchConfidence: null,
                    sortOrder: 1,
                  },
                ],
              }),
            ],
          },
        ],
      });
    }

    it('shows a persistent "N ingredients · M to buy" summary bar excluding staples, and opens the buy list sheet', async () => {
      mockPlan(planWithIngredients());

      renderMealPlanPage();

      const summaryButton = await screen.findByRole("button", { name: /1 ingredient · 1 to buy/i });
      const user = userEvent.setup();
      await user.click(summaryButton);

      expect(
        await screen.findByRole("heading", { level: 2, name: /buy list/i })
      ).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 3, name: /must buy/i })).toBeInTheDocument();
      expect(screen.getByText("Onion")).toBeInTheDocument();
      // The staple never appears on the buy list.
      expect(screen.queryByText("Salt")).not.toBeInTheDocument();
    });

    it("wires the per-day to-buy count into DaySection's header", async () => {
      mockPlan(planWithIngredients());
      renderMealPlanPage();
      await screen.findByRole("heading", { level: 2, name: /tuesday, sep 8/i });
      expect(screen.getByText("1 to buy")).toBeInTheDocument();
    });

    it("committing the buy list calls the commit mutation once and announces the result", async () => {
      mockPlan(planWithIngredients());
      let commitCalls = 0;
      let committedIds: string[] | undefined;
      server.use(
        http.post(`${API_BASE}/api/meal-plans/plan-1/shopping/commit`, async ({ request }) => {
          commitCalls += 1;
          const body = (await request.json()) as { ingredientIds?: string[] };
          committedIds = body.ingredientIds;
          return HttpResponse.json({ success: true, data: { created: 1 } });
        })
      );

      const user = userEvent.setup();
      renderMealPlanPage();

      await user.click(await screen.findByRole("button", { name: /1 ingredient · 1 to buy/i }));
      await user.click(await screen.findByRole("button", { name: /add 1 to re-order list/i }));

      await waitFor(() => expect(commitCalls).toBe(1));
      expect(committedIds).toEqual(["ing-1"]);
      expect(await screen.findByRole("status")).toHaveTextContent(/added 1 item/i);
    });

    it("warns instead of blandly reporting a count when the server reports skipped items", async () => {
      mockPlan(planWithIngredients());
      server.use(
        http.post(`${API_BASE}/api/meal-plans/plan-1/shopping/commit`, () =>
          HttpResponse.json({ success: true, data: { created: 0, skipped: 1 } })
        )
      );

      const user = userEvent.setup();
      renderMealPlanPage();

      await user.click(await screen.findByRole("button", { name: /1 ingredient · 1 to buy/i }));
      await user.click(await screen.findByRole("button", { name: /add 1 to re-order list/i }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /added 0 items.*1 was already on your re-order list/i
      );
    });

    it("falls back to comparing created against the requested count when skipped is absent from the response", async () => {
      mockPlan(planWithIngredients());
      server.use(
        http.post(`${API_BASE}/api/meal-plans/plan-1/shopping/commit`, () =>
          // No `skipped` field at all — simulates the server response shape before the
          // concurrent backend change lands.
          HttpResponse.json({ success: true, data: { created: 0 } })
        )
      );

      const user = userEvent.setup();
      renderMealPlanPage();

      await user.click(await screen.findByRole("button", { name: /1 ingredient · 1 to buy/i }));
      await user.click(await screen.findByRole("button", { name: /add 1 to re-order list/i }));

      expect(await screen.findByRole("status")).toHaveTextContent(/added 0 items/i);
    });

    it("flipping an ingredient's have/buy status calls the ingredient PATCH with the right args", async () => {
      mockPlan(planWithIngredients());
      let patchCalls = 0;
      let patchBody: { source?: string } | undefined;
      server.use(
        http.patch(`${API_BASE}/api/meal-plans/plan-1/ingredients/ing-1`, async ({ request }) => {
          patchCalls += 1;
          patchBody = (await request.json()) as { source?: string };
          return HttpResponse.json({
            success: true,
            data: {
              id: "ing-1",
              householdId: "household-1",
              mealId: "meal-1",
              rawText: "2 onions",
              nameNormalized: "onion",
              quantity: 2,
              unit: "unit",
              preparation: null,
              optional: false,
              source: "pantry",
              sourceOverridden: true,
              matchedItemId: null,
              shoppingListItemId: null,
              matchConfidence: null,
              sortOrder: 0,
            },
          });
        })
      );

      const user = userEvent.setup();
      renderMealPlanPage();

      await user.click(await screen.findByRole("button", { name: /1 ingredient · 1 to buy/i }));
      await user.click(
        await screen.findByRole("button", { name: /mark onion as already have it/i })
      );

      await waitFor(() => expect(patchCalls).toBe(1));
      expect(patchBody).toEqual({ source: "pantry" });
    });
  });
});
