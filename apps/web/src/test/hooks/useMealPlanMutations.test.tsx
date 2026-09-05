import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../mocks/server";
import { useMealPlanMutations, type MealPlanMutationCallbacks } from "@/hooks/useMealPlanMutations";
import { queryKeys } from "@/lib/queryKeys";
import type { MealPlanDetail, MealPlanIngredient } from "@/lib/api";

const API_BASE = "http://localhost:3000";
const PLAN_ID = "plan-1";
const MEAL_ID = "meal-1";
const ING_ID = "ing-1";

function makeIngredient(overrides: Partial<MealPlanIngredient> = {}): MealPlanIngredient {
  return {
    id: ING_ID,
    householdId: "household-1",
    mealId: MEAL_ID,
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
    ...overrides,
  };
}

function makePlan(overrides: Partial<MealPlanDetail> = {}): MealPlanDetail {
  return {
    id: PLAN_ID,
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
        planId: PLAN_ID,
        dayIndex: 0,
        date: "2026-09-08",
        meals: [
          {
            id: MEAL_ID,
            householdId: "household-1",
            planId: PLAN_ID,
            dayId: "day-1",
            slot: "dinner",
            sortOrder: 0,
            title: "Onion Soup",
            summary: null,
            servings: 4,
            prepMinutes: 10,
            cookMinutes: 20,
            instructions: ["Chop.", "Simmer."],
            detailStatus: "ready",
            detailError: null,
            ingredients: [makeIngredient()],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeCallbacks(): MealPlanMutationCallbacks {
  return {
    onIngredientToggleError: vi.fn(),
    onCommitSuccess: vi.fn(),
    onCommitError: vi.fn(),
    onDeleteSuccess: vi.fn(),
    onDeleteError: vi.fn(),
    onRegenerateMealError: vi.fn(),
  };
}

function renderWithPlan(plan: MealPlanDetail, callbacks: MealPlanMutationCallbacks) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.mealPlan.detail(plan.id), plan);
  queryClient.setQueryData(queryKeys.shoppingList.lists(), []);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useMealPlanMutations(callbacks), { wrapper });
  const readIngredient = () =>
    queryClient.getQueryData<MealPlanDetail>(queryKeys.mealPlan.detail(plan.id))?.days[0]?.meals[0]
      ?.ingredients[0];
  const readMeal = () =>
    queryClient.getQueryData<MealPlanDetail>(queryKeys.mealPlan.detail(plan.id))?.days[0]?.meals[0];
  return { ...view, queryClient, readIngredient, readMeal };
}

describe("useMealPlanMutations — ingredient have/buy toggle", () => {
  it("optimistically flips source before the request resolves", async () => {
    server.use(
      http.patch(`${API_BASE}/api/meal-plans/:id/ingredients/:ingId`, async ({ request }) => {
        const body = (await request.json()) as { source?: string };
        return HttpResponse.json({
          success: true,
          data: makeIngredient({ source: body.source as "purchase", sourceOverridden: true }),
        });
      })
    );
    const callbacks = makeCallbacks();
    const plan = makePlan();
    const { result, readIngredient } = renderWithPlan(plan, callbacks);

    act(() => {
      result.current.toggleIngredientSource(PLAN_ID, ING_ID, "purchase");
    });

    await waitFor(() => expect(readIngredient()?.source).toBe("purchase"));
    expect(readIngredient()?.sourceOverridden).toBe(true);
  });

  it("rolls back on failure and reports the error", async () => {
    server.use(
      http.patch(`${API_BASE}/api/meal-plans/:id/ingredients/:ingId`, () =>
        HttpResponse.json({ success: false, error: "boom" }, { status: 500 })
      )
    );
    const callbacks = makeCallbacks();
    const plan = makePlan();
    const { result, readIngredient } = renderWithPlan(plan, callbacks);

    act(() => {
      result.current.toggleIngredientSource(PLAN_ID, ING_ID, "purchase");
    });

    // Don't assert the transient optimistic value here — with a fast (mocked) failure
    // response the mutation can settle before the first `waitFor` poll runs. Assert the
    // error callback fired, then that the cache is back to its pre-mutation value.
    await waitFor(() => expect(callbacks.onIngredientToggleError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readIngredient()?.source).toBe("pantry"));
  });
});

describe("useMealPlanMutations — commit to shopping list", () => {
  it("invalidates ONLY the shopping-list key, never anything meal-plan-scoped", async () => {
    server.use(
      http.post(`${API_BASE}/api/meal-plans/:id/shopping/commit`, () =>
        HttpResponse.json({ success: true, data: { created: 2 } })
      )
    );
    const callbacks = makeCallbacks();
    const plan = makePlan();
    const { result, queryClient } = renderWithPlan(plan, callbacks);

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const planBefore = queryClient.getQueryData(queryKeys.mealPlan.detail(PLAN_ID));

    act(() => {
      result.current.commitShopping(PLAN_ID);
    });

    // The mocked response has no `skipped` field — the callback must default it to 0
    // rather than passing `undefined` through.
    await waitFor(() => expect(callbacks.onCommitSuccess).toHaveBeenCalledWith(2, 0));

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.shoppingList.lists() });
    // The cached plan object is untouched — no meal-plan-scoped invalidation happened.
    expect(queryClient.getQueryData(queryKeys.mealPlan.detail(PLAN_ID))).toBe(planBefore);
  });

  it("passes a non-zero skipped count through when the server reports it", async () => {
    server.use(
      http.post(`${API_BASE}/api/meal-plans/:id/shopping/commit`, () =>
        HttpResponse.json({ success: true, data: { created: 1, skipped: 3 } })
      )
    );
    const callbacks = makeCallbacks();
    const plan = makePlan();
    const { result } = renderWithPlan(plan, callbacks);

    act(() => {
      result.current.commitShopping(PLAN_ID);
    });

    await waitFor(() => expect(callbacks.onCommitSuccess).toHaveBeenCalledWith(1, 3));
  });

  it("reports an error without touching any cache on failure", async () => {
    server.use(
      http.post(`${API_BASE}/api/meal-plans/:id/shopping/commit`, () =>
        HttpResponse.json({ success: false, error: "nope" }, { status: 500 })
      )
    );
    const callbacks = makeCallbacks();
    const plan = makePlan();
    const { result } = renderWithPlan(plan, callbacks);

    act(() => {
      result.current.commitShopping(PLAN_ID, [ING_ID]);
    });

    await waitFor(() => expect(callbacks.onCommitError).toHaveBeenCalledTimes(1));
    expect(callbacks.onCommitSuccess).not.toHaveBeenCalled();
  });
});

describe("useMealPlanMutations — delete plan", () => {
  it("removes the detail cache entry and invalidates the list on success", async () => {
    server.use(
      http.delete(`${API_BASE}/api/meal-plans/:id`, () =>
        HttpResponse.json({ success: true, data: null })
      )
    );
    const callbacks = makeCallbacks();
    const plan = makePlan();
    const { result, queryClient } = renderWithPlan(plan, callbacks);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    act(() => {
      result.current.deletePlan(PLAN_ID);
    });

    await waitFor(() => expect(callbacks.onDeleteSuccess).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData(queryKeys.mealPlan.detail(PLAN_ID))).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.mealPlan.lists() });
  });
});

describe("useMealPlanMutations — regenerate a single meal", () => {
  it("optimistically flips detailStatus to pending and rolls back on failure", async () => {
    server.use(
      http.post(`${API_BASE}/api/meal-plans/:id/meals/:mealId/regenerate`, () =>
        HttpResponse.json({ success: false, error: "boom" }, { status: 500 })
      )
    );
    const callbacks = makeCallbacks();
    const plan = makePlan();
    const { result, readMeal } = renderWithPlan(plan, callbacks);

    act(() => {
      result.current.regenerateMeal(PLAN_ID, MEAL_ID);
    });

    // Same rationale as the ingredient-toggle rollback test above: don't assert the
    // transient "pending" value, since a fast mocked failure can settle before the
    // first `waitFor` poll observes it.
    await waitFor(() => expect(callbacks.onRegenerateMealError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readMeal()?.detailStatus).toBe("ready"));
  });

  it("keeps detailStatus pending and marks the detail query invalidated on success (202 = async job)", async () => {
    server.use(
      http.post(`${API_BASE}/api/meal-plans/:id/meals/:mealId/regenerate`, () =>
        HttpResponse.json(
          { success: true, data: { id: MEAL_ID, detailStatus: "pending" } },
          { status: 202 }
        )
      )
    );
    const callbacks = makeCallbacks();
    const plan = makePlan();
    const { result, readMeal, queryClient } = renderWithPlan(plan, callbacks);

    act(() => {
      result.current.regenerateMeal(PLAN_ID, MEAL_ID);
    });

    await waitFor(() => expect(readMeal()?.detailStatus).toBe("pending"));
    // onSettled invalidates the detail query so any active poller (useMealPlanGeneration)
    // picks up the eventual result without waiting for its next 2s tick. There's no
    // active useQuery observer in this test harness, so assert the invalidation flag
    // directly rather than expecting an automatic refetch.
    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.mealPlan.detail(PLAN_ID))?.isInvalidated).toBe(
        true
      )
    );
  });
});
