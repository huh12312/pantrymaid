// Use relative paths - proxied by Vite dev server to avoid CORS and cross-origin cookie issues
const API_BASE_URL = "";

export interface InventoryItem {
  id: string;
  name: string;
  brand?: string;
  quantity: number;
  unit: string;
  location: "pantry" | "fridge" | "freezer";
  category?: string;
  expirationDate?: string;
  barcodeUpc?: string;
  imageUrl?: string;
  notes?: string;
  householdId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemDto {
  name: string;
  brand?: string;
  quantity: number;
  unit: string;
  location: "pantry" | "fridge" | "freezer";
  category?: string;
  expirationDate?: string;
  barcodeUpc?: string;
  imageUrl?: string;
  notes?: string;
}

export interface UpdateItemDto extends Partial<CreateItemDto> {}

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
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
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
    const error = await response.json().catch(() => ({ message: "Request failed" })) as { message?: string };
    throw new Error(error.message ?? `HTTP ${response.status}`);
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

  register: (email: string, password: string, name: string) =>
    fetchApi<{ user: User }>("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),

  logout: () =>
    fetchApi<void>("/api/auth/sign-out", {
      method: "POST",
    }),

  // Household
  createHousehold: async (name: string) => {
    const response = await fetchApi<{ success: boolean; data: Household }>("/api/households", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return response.data;
  },

  // TODO: Server needs a POST /api/households/join endpoint that accepts just inviteCode
  // Current server API requires household ID in URL which user doesn't have
  joinHousehold: async (inviteCode: string) => {
    const response = await fetchApi<{ success: boolean; data: Household }>("/api/households/join", {
      method: "POST",
      body: JSON.stringify({ inviteCode }),
    });
    return response.data;
  },

  getHousehold: async (householdId: string) => {
    const response = await fetchApi<{ success: boolean; data: Household }>(`/api/households/${householdId}`);
    return response.data;
  },

  // Inventory
  getItems: async (location?: string) => {
    const query = location ? `?location=${location}` : "";
    const response = await fetchApi<{ success: boolean; data: { items: InventoryItem[] } }>(`/api/items${query}`);
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
    const response = await fetchApi<{ success: boolean; data: InventoryItem }>(`/api/items/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
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

    return fetchApi<unknown>("/api/receipt", {
      method: "POST",
      body: JSON.stringify({ imageBase64 }),
    });
  },
};
