export const queryKeys = {
  houses: {
    all: ["houses"] as const,
    lists: () => [...queryKeys.houses.all, "list"] as const,
  },
  inventory: {
    all: ["inventory"] as const,
    lists: () => [...queryKeys.inventory.all, "list"] as const,
    list: (houseId?: string | null, location?: string) =>
      [...queryKeys.inventory.lists(), { houseId, location }] as const,
    details: () => [...queryKeys.inventory.all, "detail"] as const,
    detail: (id: string) => [...queryKeys.inventory.details(), id] as const,
  },
  household: {
    all: ["household"] as const,
    details: () => [...queryKeys.household.all, "detail"] as const,
  },
  user: {
    all: ["user"] as const,
    current: () => [...queryKeys.user.all, "current"] as const,
  },
  shoppingList: {
    all: ["shoppingList"] as const,
    lists: () => [...queryKeys.shoppingList.all, "list"] as const,
  },
  // Meal planning (docs/plans/meal-planning.md §5.8). `houseId` is carried in `list`/
  // `current` purely as a cache-segregation key — like `inventory.list` above, NOT
  // because the endpoint accepts a houseId filter (meal plans are household-scoped,
  // not house/location-scoped). Do not cache derived have/buy purchase status under
  // any of these keys: that's computed at render from `mealPlan.detail x inventory.list
  // x shoppingList.lists`, so every existing inventory invalidation already refreshes
  // it for free. On logout or house switch, removeQueries({queryKey: mealPlan.all}).
  mealPlan: {
    all: ["mealPlan"] as const,
    lists: () => [...queryKeys.mealPlan.all, "list"] as const,
    list: (houseId?: string | null) => [...queryKeys.mealPlan.lists(), { houseId }] as const,
    details: () => [...queryKeys.mealPlan.all, "detail"] as const,
    detail: (planId: string) => [...queryKeys.mealPlan.details(), planId] as const,
    current: (houseId?: string | null) =>
      [...queryKeys.mealPlan.all, "current", { houseId }] as const,
    // NOT used to cache derived have/buy status (see the file-level comment above) —
    // this key exists only for the server-computed `GET /:id/shopping` aggregate
    // (`api.getMealPlanShopping`), which the buy-list surface deliberately does not
    // consume for classification, per the cache rule.
    shopping: (planId: string) => [...queryKeys.mealPlan.all, "shopping", planId] as const,
  },
  aiSettings: {
    all: ["aiSettings"] as const,
    details: () => [...queryKeys.aiSettings.all, "detail"] as const,
    // Segregated per provider — switching the provider Select must never show stale
    // suggestions from whichever provider was previously selected (plan §5.6).
    models: (provider: string) => [...queryKeys.aiSettings.all, "models", provider] as const,
  },
};
