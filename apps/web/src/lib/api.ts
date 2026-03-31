const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

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
  const token = localStorage.getItem("auth_token");

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

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
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
    fetchApi<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string, name: string) =>
    fetchApi<{ user: User; token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),

  logout: () =>
    fetchApi<void>("/auth/logout", {
      method: "POST",
    }),

  // Household
  createHousehold: (name: string) =>
    fetchApi<Household>("/household", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  joinHousehold: (inviteCode: string) =>
    fetchApi<Household>("/household/join", {
      method: "POST",
      body: JSON.stringify({ inviteCode }),
    }),

  getHousehold: () => fetchApi<Household>("/household"),

  // Inventory
  getItems: (location?: string) => {
    const query = location ? `?location=${location}` : "";
    return fetchApi<InventoryItem[]>(`/inventory${query}`);
  },

  getItem: (id: string) => fetchApi<InventoryItem>(`/inventory/${id}`),

  createItem: (data: CreateItemDto) =>
    fetchApi<InventoryItem>("/inventory", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateItem: (id: string, data: UpdateItemDto) =>
    fetchApi<InventoryItem>(`/inventory/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteItem: (id: string) =>
    fetchApi<void>(`/inventory/${id}`, {
      method: "DELETE",
    }),

  // Barcode lookup
  lookupBarcode: (barcode: string) =>
    fetchApi<{ name: string; category?: string }>(`/inventory/barcode/${barcode}`),

  // Receipt upload
  uploadReceipt: async (file: File) => {
    const formData = new FormData();
    formData.append("receipt", file);

    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/receipts/upload`, {
      method: "POST",
      headers,
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
