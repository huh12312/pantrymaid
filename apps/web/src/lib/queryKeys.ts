export const queryKeys = {
  inventory: {
    all: ["inventory"] as const,
    lists: () => [...queryKeys.inventory.all, "list"] as const,
    list: (location?: string) =>
      [...queryKeys.inventory.lists(), { location }] as const,
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
};
