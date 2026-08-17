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
} from "@pantrymaid/shared/schemas";
import type {
  ItemLocation,
  ProductSearchResult,
  ReceiptProcessingResult,
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
};
