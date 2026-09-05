// Use relative paths - proxied by Vite dev server to avoid CORS and cross-origin cookie issues
const API_BASE_URL = "";

let _onUnauthorized: (() => void) | null = null;

export function registerUnauthorizedCallback(fn: () => void): void {
  _onUnauthorized = fn;
}

export type {
  ItemLocation,
  ProductSearchResult,
  ReceiptProcessingResult,
  // Meal planning — enum-shaped types have no wire-format surprises, so they are
  // re-exported as-is (plan §4.4). Entity types with Date-coerced fields (MealPlan,
  // MealPlanPrompt) are NOT re-exported raw — see the local overrides below.
  LLMProvider,
  LlmSettings,
  UpdateLlmSettingsInput,
  TestLlmSettingsInput,
  LlmTestError,
  LlmTestResult,
  LlmModelsReason,
  LlmModelsResponse,
  MealSlot,
  MealPlanMode,
  MealPlanStatus,
  MealPlanDetailStatus,
  IngredientSource,
  MealPlanIngredient,
  CreateMealPlanInput,
  UpdateMealPlanIngredientInput,
  MealPlanShoppingState,
  MealPlanShoppingUsedOn,
  MealPlanShoppingAggregate,
  MealPlanShoppingList,
  CommitMealPlanShoppingInput,
  CreateMealPlanPromptInput,
  UpdateMealPlanPromptInput,
} from "@pantrymaid/shared/schemas";
import type {
  ItemLocation,
  ProductSearchResult,
  ReceiptProcessingResult,
  LLMProvider,
  LlmSettings,
  UpdateLlmSettingsInput,
  TestLlmSettingsInput,
  LlmTestResult,
  LlmModelsResponse,
  MealPlanStatus,
  MealPlanDay as MealPlanDaySchema,
  MealPlanMeal as MealPlanMealSchema,
  MealPlanIngredient,
  MealPlan as MealPlanSchema,
  CreateMealPlanInput,
  UpdateMealPlanIngredientInput,
  MealPlanShoppingList,
  CommitMealPlanShoppingInput,
  MealPlanPrompt as MealPlanPromptSchema,
  CreateMealPlanPromptInput,
  UpdateMealPlanPromptInput,
} from "@pantrymaid/shared/schemas";

export interface InventoryItem {
  id: string;
  name: string;
  brand?: string | null;
  quantity: number;
  unit?: string | null;
  location: ItemLocation;
  category?: string | null;
  expirationDate?: string | null;
  expirationEstimated: boolean;
  barcodeUpc?: string | null;
  imageUrl?: string | null;
  notes?: string | null;
  householdId: string;
  addedBy: string;
  addedAt: string;
  updatedAt: string;
  opened?: boolean | null;
}

export interface CreateItemDto {
  name: string;
  brand?: string;
  quantity: number;
  unit: string;
  location: ItemLocation;
  category?: string;
  // null is a deliberate, distinct value from undefined here: it means "clear
  // the expiry date" on the edit path (survives the shared Zod schema's
  // `.nullable()` and reaches `.set({ expirationDate: null })`), whereas
  // undefined means "no change" (dropped before the request body is built).
  expirationDate?: string | null;
  expirationEstimated?: boolean;
  barcodeUpc?: string;
  imageUrl?: string;
  notes?: string;
  opened?: boolean;
  houseId?: string;
}

export type UpdateItemDto = Partial<CreateItemDto>;

export interface ShoppingListItem {
  id: string;
  householdId: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  unit?: string | null;
  suggestedQty: number;
  sourceItemId?: string | null;
  status: "pending" | "purchased";
  addedBy: string;
  addedAt: string;
  updatedAt: string;
}

export interface CreateShoppingListItemDto {
  name: string;
  brand?: string;
  category?: string;
  unit?: string;
  suggestedQty?: number;
  sourceItemId?: string;
}

export interface ItemSuggestion {
  unit: string;
  category: string;
  estimatedShelfDays: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  householdId?: string;
}

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
  krogerLocationId?: string | null;
  krogerStoreName?: string | null;
  krogerChain?: string | null;
  krogerZipCode?: string | null;
}

export interface StoreResult {
  locationId: string;
  name: string;
  chain: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface House {
  id: string;
  householdId: string;
  name: string;
  createdAt: string;
}

export interface HouseholdStoreSettings {
  krogerLocationId?: string | null;
  krogerStoreName?: string | null;
  krogerChain?: string | null;
  krogerZipCode?: string | null;
}

// ---------------------------------------------------------------------------------
// Meal planning (docs/plans/meal-planning.md §4.4, §5.5, §5.8)
//
// `mealPlanSchema`/`mealPlanPromptSchema` declare `createdAt`/`completedAt`/`updatedAt`
// as `z.coerce.date()`, so the *inferred* type is `Date`. But `fetchApi` never runs the
// Zod schema at runtime — it's a plain `response.json() as T` — so the value actually
// on the object at runtime is the ISO string the server sent. Re-exporting the shared
// type as-is would silently lie about this (a `.getTime()` call would compile and then
// throw). These local aliases fix only that mismatch and otherwise reuse the shared
// shape untouched, matching the file's existing precedent of not reusing full entity
// types for wire responses (see `InventoryItem` above vs. shared `Item`).
// ---------------------------------------------------------------------------------

export type MealPlanPrompt = Omit<MealPlanPromptSchema, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

/** A single day's meals, as returned nested inside `getMealPlan` (ingredients always present). */
export type MealPlanMealDetail = Omit<MealPlanMealSchema, "ingredients"> & {
  ingredients: MealPlanIngredient[];
};

export type MealPlanDayDetail = Omit<MealPlanDaySchema, "meals"> & {
  meals: MealPlanMealDetail[];
};

/**
 * `GET /api/meal-plans` summary shape — no `days` key at all (plan §4.4: "no nesting").
 * This is also the shape returned by `createMealPlan`-adjacent mutations that hand back
 * a full row (`cancelMealPlan`).
 */
export type MealPlanSummary = Omit<MealPlanSchema, "days" | "createdAt" | "completedAt"> & {
  createdAt: string;
  completedAt: string | null;
};

/**
 * `GET /api/meal-plans/:id` — the polling endpoint. `days` is always an array (possibly
 * empty before the skeleton phase completes), never omitted, unlike the base shared type.
 */
export type MealPlanDetail = Omit<MealPlanSummary, "days"> & {
  days: MealPlanDayDetail[];
};

/**
 * The stable, fixed set of terminal generation failure codes a plan row can carry
 * (`server/src/lib/mealplan/generate.ts`). NOT the same enum as `LlmTestError` — that
 * one additionally has `rate_limited` because the Test Connection probe never retries.
 * Generation *does* retry 429s with backoff (`withRetry`), so a rate limit that
 * ultimately exhausts retries surfaces here as `provider_unavailable`, not a distinct
 * rate-limited code. See `useMealPlanGeneration`'s error-kind mapping for the consumer
 * side of this.
 */
export type MealPlanGenerationErrorCode =
  | "invalid_api_key"
  | "provider_unavailable"
  | "unparseable_output"
  | "timeout"
  | "cancelled"
  | "interrupted";

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.headers) {
    Object.entries(options.headers).forEach(([key, value]) => {
      if (typeof value === "string") {
        headers[key] = value;
      }
    });
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    if (
      response.status === 401 &&
      !endpoint.includes("/api/auth/sign-in") &&
      !endpoint.includes("/api/auth/sign-up")
    ) {
      _onUnauthorized?.();
      throw new Error("Session expired. Please log in again.");
    }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const message =
      (body?.message as string) ??
      (body?.error as string) ??
      (body?.statusMessage as string) ??
      `Request failed (${response.status})`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    fetchApi<{ user: User }>("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string, name: string, inviteCode?: string) =>
    fetchApi<{ user: User }>("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password, name, ...(inviteCode ? { inviteCode } : {}) }),
    }),

  validateInviteCode: async (code: string): Promise<{ valid: boolean; householdName?: string }> => {
    const response = await fetchApi<{ valid: boolean; householdName?: string }>(
      `/api/households/validate-invite?code=${encodeURIComponent(code)}`
    );
    return response;
  },

  getSession: async (): Promise<{ user: User } | null> => {
    // Use raw fetch — bypasses the 401 interceptor so a missing/expired
    // session cookie is treated as "not logged in" rather than a logout trigger.
    const res = await fetch(`${API_BASE_URL}/api/auth/session`, { credentials: "include" });
    if (!res.ok) return null;
    return res.json() as Promise<{ user: User }>;
  },

  logout: () =>
    fetchApi<void>("/api/auth/sign-out", {
      method: "POST",
    }),

  getConfig: () => fetchApi<{ signupEnabled: boolean }>("/api/config"),

  // Household
  createHousehold: async (name: string) => {
    const response = await fetchApi<{ success: boolean; data: Household }>("/api/households", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return response.data;
  },

  leaveAndJoin: async (
    inviteCode: string
  ): Promise<{ householdId: string; householdName: string }> => {
    const response = await fetchApi<{
      success: boolean;
      data: { householdId: string; householdName: string };
    }>("/api/households/leave-and-join", { method: "POST", body: JSON.stringify({ inviteCode }) });
    return response.data;
  },

  joinHousehold: async (inviteCode: string) => {
    const response = await fetchApi<{ success: boolean; data: Household }>("/api/households/join", {
      method: "POST",
      body: JSON.stringify({ inviteCode }),
    });
    return response.data;
  },

  getHousehold: async () => {
    const response = await fetchApi<{ success: boolean; data: Household }>("/api/households/me");
    return response.data;
  },

  // Houses
  getHouses: async (): Promise<House[]> => {
    const response = await fetchApi<{ success: boolean; data: House[] }>("/api/houses");
    return response.data ?? [];
  },
  createHouse: async (name: string): Promise<House> => {
    const response = await fetchApi<{ success: boolean; data: House }>("/api/houses", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return response.data;
  },
  renameHouse: async (id: string, name: string): Promise<House> => {
    const response = await fetchApi<{ success: boolean; data: House }>(`/api/houses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    return response.data;
  },
  deleteHouse: async (id: string): Promise<void> => {
    await fetchApi<{ success: boolean }>(`/api/houses/${id}`, { method: "DELETE" });
  },

  // Inventory
  getItems: async (houseId?: string | null, location?: string) => {
    const params = new URLSearchParams();
    if (houseId) params.set("houseId", houseId);
    if (location) params.set("location", location);
    const qs = params.toString();
    const response = await fetchApi<{ success: boolean; data: { items: InventoryItem[] } }>(
      `/api/items${qs ? `?${qs}` : ""}`
    );
    return response.data.items;
  },

  getItem: async (id: string) => {
    const response = await fetchApi<{ success: boolean; data: InventoryItem }>(`/api/items/${id}`);
    return response.data;
  },

  createItem: async (data: CreateItemDto) => {
    const response = await fetchApi<{ success: boolean; data: InventoryItem }>("/api/items", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  updateItem: async (id: string, data: UpdateItemDto) => {
    // Only strip undefined. null is intentional for clearing nullable fields.
    // NOTE: only expirationDate is declared .nullable() in updateItemSchema;
    // string fields (brand, notes, unit, etc.) reject null and must be omitted or sent as "".
    const payload = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    const response = await fetchApi<{ success: boolean; data: InventoryItem }>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return response.data;
  },

  deleteItem: async (id: string) => {
    await fetchApi<{ success: boolean; data: null }>(`/api/items/${id}`, {
      method: "DELETE",
    });
  },

  // Barcode lookup
  lookupBarcode: async (barcode: string) => {
    const response = await fetchApi<{
      success: boolean;
      data: { name: string; brand?: string; category?: string; imageUrl?: string };
    }>(`/api/barcode/${barcode}`);
    return response.data;
  },

  // Product search (name-based, all providers: Kroger + Open Food Facts)
  searchProducts: async (q: string): Promise<ProductSearchResult[]> => {
    const params = new URLSearchParams({ q, limit: "10" });
    const response = await fetchApi<{ success: boolean; data: ProductSearchResult[] }>(
      `/api/products/search?${params}`
    );
    return response.data ?? [];
  },

  // Receipt upload — converts File to base64, sends JSON as server expects
  uploadReceipt: async (file: File) => {
    const imageBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data URL prefix (e.g. "data:image/jpeg;base64,")
        resolve(result.split(",")[1] ?? result);
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

    const response = await fetchApi<{ success: boolean; data: ReceiptProcessingResult }>(
      "/api/receipt",
      {
        method: "POST",
        body: JSON.stringify({ imageBase64 }),
      }
    );
    return response.data;
  },

  // Shopping list
  getShoppingList: async (): Promise<ShoppingListItem[]> => {
    const response = await fetchApi<{ success: boolean; data: ShoppingListItem[] }>(
      "/api/shopping-list"
    );
    return response.data;
  },

  addToShoppingList: async (data: CreateShoppingListItemDto): Promise<ShoppingListItem> => {
    const response = await fetchApi<{ success: boolean; data: ShoppingListItem }>(
      "/api/shopping-list",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
    return response.data;
  },

  markShoppingListPurchased: async (id: string): Promise<ShoppingListItem> => {
    const response = await fetchApi<{ success: boolean; data: ShoppingListItem }>(
      `/api/shopping-list/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "purchased" }),
      }
    );
    return response.data;
  },

  deleteShoppingListItem: async (id: string): Promise<void> => {
    await fetchApi<{ success: boolean; data: null }>(`/api/shopping-list/${id}`, {
      method: "DELETE",
    });
  },

  // Store search (Kroger locations by zip)
  searchStores: async (zip: string): Promise<StoreResult[]> => {
    const response = await fetchApi<{ success: boolean; data: StoreResult[] }>(
      `/api/stores/search?zip=${encodeURIComponent(zip)}`
    );
    return response.data ?? [];
  },

  // Household store settings
  updateHouseholdSettings: async (settings: HouseholdStoreSettings): Promise<Household> => {
    const response = await fetchApi<{ success: boolean; data: Household }>(
      "/api/households/me/settings",
      {
        method: "PATCH",
        body: JSON.stringify(settings),
      }
    );
    return response.data;
  },

  // AI suggest
  suggestItemDefaults: async (name: string): Promise<ItemSuggestion> => {
    const response = await fetchApi<{ success: boolean; data: ItemSuggestion }>(
      "/api/items/suggest",
      {
        method: "POST",
        body: JSON.stringify({ name }),
      }
    );
    return response.data;
  },

  // ------------------------------------------------------------------------------
  // LLM / AI settings (plan §4.4, §5.6, §6.2). The API key is write-only: no method
  // here ever receives or returns the full key. `getLlmSettings` gives back only
  // `keyConfigured`/`keyLast4`; `updateLlmSettings` sends `apiKey` up but omitting it
  // keeps the existing stored key; `testLlmSettings` can probe an unsaved key without
  // persisting it.
  //
  // `LlmSettings`/`UpdateLlmSettingsInput` are re-exported as-is from
  // `@pantrymaid/shared/schemas` (no local Omit<...> alias needed, unlike the meal-plan
  // types below) because none of their fields are `z.coerce.date()` — `visionModel` and
  // `envDefaults.visionModel` are plain nullable strings, so what `fetchApi`'s
  // unvalidated `response.json() as T` returns at runtime already matches the inferred
  // type exactly. `visionModel` on the PUT side follows the same
  // omitted/null/string precedent as `apiKey`: omitted keeps the household's existing
  // override, `null` clears it back to the env/default, and a string sets it.
  // ------------------------------------------------------------------------------

  getLlmSettings: async (): Promise<LlmSettings> => {
    const response = await fetchApi<{ success: boolean; data: LlmSettings }>("/api/settings/llm");
    return response.data;
  },

  updateLlmSettings: async (data: UpdateLlmSettingsInput): Promise<LlmSettings> => {
    const response = await fetchApi<{ success: boolean; data: LlmSettings }>("/api/settings/llm", {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  testLlmSettings: async (data: TestLlmSettingsInput = {}): Promise<LlmTestResult> => {
    const response = await fetchApi<{ success: boolean; data: LlmTestResult }>(
      "/api/settings/llm/test",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
    return response.data;
  },

  // Live model catalogue for the provider select (plan §5.6) — suggestions only, never
  // a hard constraint. `reason` explains an empty list (no key configured, provider
  // unreachable, etc.) without ever surfacing raw provider error text; callers must
  // treat any non-empty `reason` (or a rejected promise) as "fall back to free text
  // silently", never as a blocking error.
  getLlmModels: async (provider: LLMProvider): Promise<LlmModelsResponse> => {
    const response = await fetchApi<{ success: boolean; data: LlmModelsResponse }>(
      `/api/settings/llm/models?provider=${encodeURIComponent(provider)}`
    );
    return response.data;
  },

  // ------------------------------------------------------------------------------
  // Meal plan prompts CRUD (plan §4.4, §5.6). `body` is an immutable-base template
  // append, validated server-side against the 8000-char cap.
  // ------------------------------------------------------------------------------

  listMealPlanPrompts: async (): Promise<MealPlanPrompt[]> => {
    const response = await fetchApi<{ success: boolean; data: MealPlanPrompt[] }>(
      "/api/meal-plans/prompts"
    );
    return response.data;
  },

  createMealPlanPrompt: async (data: CreateMealPlanPromptInput): Promise<MealPlanPrompt> => {
    const response = await fetchApi<{ success: boolean; data: MealPlanPrompt }>(
      "/api/meal-plans/prompts",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
    return response.data;
  },

  updateMealPlanPrompt: async (
    id: string,
    data: UpdateMealPlanPromptInput
  ): Promise<MealPlanPrompt> => {
    const response = await fetchApi<{ success: boolean; data: MealPlanPrompt }>(
      `/api/meal-plans/prompts/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
    return response.data;
  },

  deleteMealPlanPrompt: async (id: string): Promise<void> => {
    await fetchApi<{ success: boolean; data: null }>(`/api/meal-plans/prompts/${id}`, {
      method: "DELETE",
    });
  },

  // ------------------------------------------------------------------------------
  // Meal plans (plan §4.4, §5.5, §5.8). Generation is server-owned: `createMealPlan`
  // only enqueues the job and returns immediately (202); `getMealPlan` is the polling
  // endpoint that returns the plan built so far plus `status`/`progressDone`/
  // `progressTotal`, safe to call on an interval or to re-attach to after a remount.
  // ------------------------------------------------------------------------------

  /** Enqueues generation. Returns immediately (202) — poll `getMealPlan(id)` for progress. */
  createMealPlan: async (
    data: CreateMealPlanInput
  ): Promise<{ id: string; status: MealPlanStatus }> => {
    const response = await fetchApi<{
      success: boolean;
      data: { id: string; status: MealPlanStatus };
    }>("/api/meal-plans", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Paginated summaries, most recent first, `days` omitted (plan §4.4: "no nesting").
   * The server response carries no `total` — build pagination UI accordingly (there is
   * no count to show "N of M").
   */
  listMealPlans: async (
    params: { page?: number; pageSize?: number } = {}
  ): Promise<{ items: MealPlanSummary[]; page: number; pageSize: number }> => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const query = qs.toString();
    const response = await fetchApi<{
      success: boolean;
      data: { items: MealPlanSummary[]; page: number; pageSize: number };
    }>(`/api/meal-plans${query ? `?${query}` : ""}`);
    return response.data;
  },

  /**
   * The most recent meal plan for the household, or `null` if none exists yet. Used to
   * re-attach to an in-flight generation on mount (plan §5.5) — check `.status` against
   * a `generating_*`/`queued` value before treating it as "currently generating".
   */
  getCurrentMealPlan: async (): Promise<MealPlanSummary | null> => {
    const { items } = await api.listMealPlans({ page: 1, pageSize: 1 });
    return items[0] ?? null;
  },

  /**
   * Full nested days -> meals -> ingredients, plus `status`/`progressDone`/
   * `progressTotal`. This IS the polling endpoint (plan §5.8): safe to call on an
   * interval, and cheap to re-fetch once generation reaches a terminal status because
   * callers should then stop polling (see `useMealPlanGeneration`).
   */
  getMealPlan: async (id: string): Promise<MealPlanDetail> => {
    const response = await fetchApi<{ success: boolean; data: MealPlanDetail }>(
      `/api/meal-plans/${id}`
    );
    return response.data;
  },

  cancelMealPlan: async (id: string): Promise<MealPlanSummary> => {
    const response = await fetchApi<{ success: boolean; data: MealPlanSummary }>(
      `/api/meal-plans/${id}/cancel`,
      { method: "POST" }
    );
    return response.data;
  },

  /** Kicks off a single-meal regeneration (202). Poll `getMealPlan` for the new detailStatus. */
  regenerateMeal: async (
    planId: string,
    mealId: string
  ): Promise<{ id: string; detailStatus: "pending" }> => {
    const response = await fetchApi<{
      success: boolean;
      data: { id: string; detailStatus: "pending" };
    }>(`/api/meal-plans/${planId}/meals/${mealId}/regenerate`, { method: "POST" });
    return response.data;
  },

  /** Flips a single ingredient between `have` (pantry/staple) and `buy` (purchase). */
  updateMealPlanIngredient: async (
    planId: string,
    ingredientId: string,
    data: UpdateMealPlanIngredientInput
  ): Promise<MealPlanIngredient> => {
    const response = await fetchApi<{ success: boolean; data: MealPlanIngredient }>(
      `/api/meal-plans/${planId}/ingredients/${ingredientId}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
    return response.data;
  },

  /** Deduped purchase list for the plan (`state` is always `"must_buy"` server-side today). */
  getMealPlanShopping: async (planId: string): Promise<MealPlanShoppingList> => {
    const response = await fetchApi<{ success: boolean; data: MealPlanShoppingList }>(
      `/api/meal-plans/${planId}/shopping`
    );
    return response.data;
  },

  /** Omitted/empty `ingredientIds` commits everything eligible. Never invalidate meal-plan-scoped
   * queries after this — plan §5.8: have/buy is derived at render, not cached. Invalidate only
   * `queryKeys.shoppingList.lists()`.
   *
   * `skipped` is optional in the response type deliberately: the server is being changed
   * concurrently to add it (so a commit that silently added 0 items can explain why —
   * e.g. everything requested was already pending). Callers must treat a missing
   * `skipped` as 0 rather than assuming the field is always present. */
  commitMealPlanShopping: async (
    planId: string,
    data: CommitMealPlanShoppingInput = {}
  ): Promise<{ created: number; skipped?: number }> => {
    const response = await fetchApi<{
      success: boolean;
      data: { created: number; skipped?: number };
    }>(`/api/meal-plans/${planId}/shopping/commit`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  deleteMealPlan: async (id: string): Promise<void> => {
    await fetchApi<{ success: boolean; data: null }>(`/api/meal-plans/${id}`, {
      method: "DELETE",
    });
  },
};
