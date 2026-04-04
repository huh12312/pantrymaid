const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  location: "pantry" | "fridge" | "freezer";
  category?: string;
  expiryDate?: string;
  barcode?: string;
  imageUrl?: string;
  notes?: string;
  householdId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemDto {
  name: string;
  quantity: number;
  unit: string;
  location: "pantry" | "fridge" | "freezer";
  category?: string;
  expiryDate?: string;
  barcode?: string;
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
  createHousehold: (name: string) =>
    fetchApi<Household>("/api/households", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  // TODO: Server needs a POST /api/households/join endpoint that accepts just inviteCode
  // Current server API requires household ID in URL which user doesn't have
  joinHousehold: (inviteCode: string) =>
    fetchApi<Household>("/api/households/join", {
      method: "POST",
      body: JSON.stringify({ inviteCode }),
    }),

  getHousehold: (householdId: string) => fetchApi<Household>(`/api/households/${householdId}`),

  // Inventory
  getItems: (location?: string) => {
    const query = location ? `?location=${location}` : "";
    return fetchApi<InventoryItem[]>(`/api/items${query}`);
  },

  getItem: (id: string) => fetchApi<InventoryItem>(`/api/items/${id}`),

  createItem: (data: CreateItemDto) =>
    fetchApi<InventoryItem>("/api/items", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateItem: (id: string, data: UpdateItemDto) =>
    fetchApi<InventoryItem>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteItem: (id: string) =>
    fetchApi<void>(`/api/items/${id}`, {
      method: "DELETE",
    }),

  // Barcode lookup
  lookupBarcode: (barcode: string) =>
    fetchApi<{ name: string; category?: string }>(`/api/barcode/${barcode}`),

  // Receipt upload
  uploadReceipt: async (file: File) => {
    const formData = new FormData();
    formData.append("receipt", file);

    const response = await fetch(`${API_BASE_URL}/api/receipt`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Upload failed" })) as { message?: string };
      throw new Error(error.message ?? `HTTP ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  },
};
