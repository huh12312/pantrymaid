import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../mocks/server";
import {
  useMealPlanGeneration,
  isGeneratingMealPlanStatus,
  planNeedsPolling,
  classifyMealPlanError,
} from "@/hooks/useMealPlanGeneration";
import type { MealPlanDetail } from "@/lib/api";

const API_BASE = "http://localhost:3000";

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
        meals: [],
      },
    ],
    ...overrides,
  };
}

function renderGeneration(options?: { planId?: string }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useMealPlanGeneration(options), { wrapper });
  return { ...view, queryClient };
}

describe("useMealPlanGeneration — pure helpers", () => {
  it("isGeneratingMealPlanStatus is true only for queued/generating_* statuses", () => {
    expect(isGeneratingMealPlanStatus("queued")).toBe(true);
    expect(isGeneratingMealPlanStatus("generating_skeleton")).toBe(true);
    expect(isGeneratingMealPlanStatus("generating_recipes")).toBe(true);
    expect(isGeneratingMealPlanStatus("ready")).toBe(false);
    expect(isGeneratingMealPlanStatus("failed")).toBe(false);
    expect(isGeneratingMealPlanStatus("cancelled")).toBe(false);
    expect(isGeneratingMealPlanStatus(null)).toBe(false);
    expect(isGeneratingMealPlanStatus(undefined)).toBe(false);
  });

  it("planNeedsPolling is true while the plan is generating", () => {
    expect(planNeedsPolling(makePlan({ status: "generating_recipes" }))).toBe(true);
    expect(planNeedsPolling(makePlan({ status: "ready" }))).toBe(false);
    expect(planNeedsPolling(null)).toBe(false);
  });

  it("planNeedsPolling stays true while any meal is mid single-meal regeneration, even though the plan's own status is terminal", () => {
    const plan = makePlan({
      status: "ready",
      days: [
        {
          id: "day-1",
          householdId: "household-1",
          planId: "plan-1",
          dayIndex: 0,
          date: "2026-09-08",
          meals: [
            {
              id: "meal-1",
              householdId: "household-1",
              planId: "plan-1",
              dayId: "day-1",
              slot: "dinner",
              sortOrder: 0,
              title: "Soup",
              summary: null,
              servings: 4,
              prepMinutes: 10,
              cookMinutes: 20,
              instructions: [],
              detailStatus: "pending",
              detailError: null,
              ingredients: [],
            },
          ],
        },
      ],
    });
    expect(planNeedsPolling(plan)).toBe(true);
  });

  it("classifyMealPlanError returns null for non-failed statuses, including cancelled", () => {
    expect(classifyMealPlanError(makePlan({ status: "ready" }))).toBeNull();
    expect(
      classifyMealPlanError(makePlan({ status: "cancelled", errorCode: "cancelled" }))
    ).toBeNull();
    expect(classifyMealPlanError(null)).toBeNull();
  });

  it.each([
    ["invalid_api_key", "invalidApiKey"],
    ["provider_unavailable", "providerUnavailable"],
    ["unparseable_output", "unusableOutput"],
    ["timeout", "timeout"],
    ["interrupted", "interrupted"],
  ] as const)("classifies errorCode %s as kind %s", (code, kind) => {
    const result = classifyMealPlanError(makePlan({ status: "failed", errorCode: code }));
    expect(result?.kind).toBe(kind);
    expect(result?.code).toBe(code);
    expect(result?.message).toBeTruthy();
  });

  it("classifies an unrecognized errorCode as unknown rather than throwing", () => {
    const result = classifyMealPlanError(
      makePlan({ status: "failed", errorCode: "some_future_code" })
    );
    expect(result?.kind).toBe("unknown");
    expect(result?.code).toBeNull();
  });
});

describe("useMealPlanGeneration — re-attach on mount", () => {
  it("re-attaches to an already-generating plan discovered via getCurrentMealPlan", async () => {
    server.use(
      http.get(`${API_BASE}/api/meal-plans`, () => {
        return HttpResponse.json({
          success: true,
          data: {
            items: [makePlan({ id: "plan-live", status: "generating_recipes" })],
            page: 1,
            pageSize: 1,
          },
        });
      }),
      http.get(`${API_BASE}/api/meal-plans/plan-live`, () => {
        return HttpResponse.json({
          success: true,
          data: makePlan({
            id: "plan-live",
            status: "generating_recipes",
            progressDone: 2,
            progressTotal: 4,
          }),
        });
      })
    );

    const { result } = renderGeneration();

    await waitFor(() => expect(result.current.planId).toBe("plan-live"));
    await waitFor(() => expect(result.current.status).toBe("generating_recipes"));
    expect(result.current.isGenerating).toBe(true);
    expect(result.current.progressDone).toBe(2);
    expect(result.current.progressTotal).toBe(4);
  });

  it("does not attach when the most recent plan is already terminal", async () => {
    server.use(
      http.get(`${API_BASE}/api/meal-plans`, () => {
        return HttpResponse.json({
          success: true,
          data: { items: [makePlan({ id: "plan-done", status: "ready" })], page: 1, pageSize: 1 },
        });
      })
    );

    const { result } = renderGeneration();

    await waitFor(() => expect(result.current.isAttaching).toBe(false));
    expect(result.current.planId).toBeNull();
    expect(result.current.isGenerating).toBe(false);
  });

  it("skips the current-plan lookup entirely when a planId is passed explicitly", async () => {
    server.use(
      http.get(`${API_BASE}/api/meal-plans/plan-explicit`, () => {
        return HttpResponse.json({
          success: true,
          data: makePlan({ id: "plan-explicit", status: "ready" }),
        });
      })
    );

    const { result } = renderGeneration({ planId: "plan-explicit" });

    expect(result.current.planId).toBe("plan-explicit");
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});

describe("useMealPlanGeneration — start and cancel", () => {
  it("start() begins tracking the newly created plan", async () => {
    server.use(
      http.get(`${API_BASE}/api/meal-plans`, () => {
        return HttpResponse.json({ success: true, data: { items: [], page: 1, pageSize: 1 } });
      }),
      http.post(`${API_BASE}/api/meal-plans`, () => {
        return HttpResponse.json(
          { success: true, data: { id: "plan-new", status: "queued" } },
          { status: 202 }
        );
      }),
      http.get(`${API_BASE}/api/meal-plans/plan-new`, () => {
        return HttpResponse.json({
          success: true,
          data: makePlan({ id: "plan-new", status: "queued" }),
        });
      })
    );

    const { result } = renderGeneration();
    await waitFor(() => expect(result.current.isAttaching).toBe(false));
    expect(result.current.planId).toBeNull();

    act(() => {
      result.current.start({
        startDate: "2026-09-08",
        dayCount: 1,
        slots: ["dinner"],
        mode: "balanced",
        includeExpired: false,
      });
    });

    await waitFor(() => expect(result.current.planId).toBe("plan-new"));
    await waitFor(() => expect(result.current.status).toBe("queued"));
  });

  it("cancel() cancels the tracked plan and updates its cached status", async () => {
    server.use(
      http.get(`${API_BASE}/api/meal-plans/plan-cancel`, () => {
        return HttpResponse.json({
          success: true,
          data: makePlan({ id: "plan-cancel", status: "generating_recipes" }),
        });
      }),
      http.post(`${API_BASE}/api/meal-plans/plan-cancel/cancel`, () => {
        return HttpResponse.json({
          success: true,
          data: makePlan({ id: "plan-cancel", status: "cancelled" }),
        });
      })
    );

    const { result } = renderGeneration({ planId: "plan-cancel" });
    await waitFor(() => expect(result.current.status).toBe("generating_recipes"));

    act(() => {
      result.current.cancel();
    });

    await waitFor(() => expect(result.current.status).toBe("cancelled"));
    expect(result.current.isGenerating).toBe(false);
  });

  it("cancel() is a no-op when nothing is being tracked", () => {
    const { result } = renderGeneration();
    expect(() => act(() => result.current.cancel())).not.toThrow();
  });
});

describe("useMealPlanGeneration — polling lifecycle", () => {
  it("polls while generating and stops once the status reaches a terminal value", async () => {
    let callCount = 0;
    server.use(
      http.get(`${API_BASE}/api/meal-plans/plan-poll`, () => {
        callCount += 1;
        const status = callCount === 1 ? "generating_recipes" : "ready";
        return HttpResponse.json({
          success: true,
          data: makePlan({
            id: "plan-poll",
            status,
            progressDone: callCount === 1 ? 1 : 4,
            progressTotal: 4,
          }),
        });
      })
    );

    const { result } = renderGeneration({ planId: "plan-poll" });

    await waitFor(() => expect(result.current.status).toBe("generating_recipes"));
    expect(result.current.isGenerating).toBe(true);

    // refetchInterval fires at 2000ms while generating; allow generous headroom.
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 5000 });
    expect(result.current.isGenerating).toBe(false);
    expect(callCount).toBeGreaterThanOrEqual(2);
  }, 7000);
});
