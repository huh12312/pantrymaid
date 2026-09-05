import { faker } from "@faker-js/faker";
import type { ItemLocation } from "@pantrymaid/shared/schemas";

/**
 * Test data factories for creating realistic test data
 */

export const factories = {
  /**
   * Generate a test household
   */
  household: (
    overrides?: Partial<{
      id: string;
      name: string;
      inviteCode: string;
      createdAt: Date;
    }>
  ) => ({
    id: faker.string.uuid(),
    name: faker.company.name(),
    inviteCode: faker.string.alphanumeric(8).toUpperCase(),
    createdAt: faker.date.recent(),
    ...overrides,
  }),

  /**
   * Generate a test user
   */
  user: (
    householdId: string,
    overrides?: Partial<{
      id: string;
      displayName: string;
      createdAt: Date;
    }>
  ) => ({
    id: faker.string.uuid(),
    householdId,
    displayName: faker.person.fullName(),
    createdAt: faker.date.recent(),
    ...overrides,
  }),

  /**
   * Generate a test item
   */
  item: (
    householdId: string,
    addedBy: string,
    overrides?: Partial<{
      id: string;
      name: string;
      brand: string | null;
      category: string | null;
      location: ItemLocation;
      quantity: string;
      unit: string | null;
      barcodeUpc: string | null;
      expirationDate: string | null;
      expirationEstimated: boolean;
      addedAt: Date;
      updatedAt: Date;
      notes: string | null;
    }>
  ) => ({
    id: faker.string.uuid(),
    householdId,
    name: faker.commerce.productName(),
    brand: faker.company.name(),
    category: faker.commerce.department(),
    location: faker.helpers.arrayElement(["pantry", "fridge", "freezer"] as ItemLocation[]),
    quantity: faker.number.int({ min: 1, max: 10 }).toString(),
    unit: faker.helpers.arrayElement(["oz", "lb", "g", "kg", "count", null]),
    barcodeUpc: faker.helpers.maybe(() => faker.string.numeric(12), { probability: 0.6 }) ?? null,
    // schema.ts's `expirationDate` is a pg `date` column in drizzle's default string
    // mode (no `{ mode: "date" }`), so postgres-js needs a "YYYY-MM-DD" string here —
    // handing it a JS Date object throws ERR_INVALID_ARG_TYPE deep in the pg driver on
    // insert.
    expirationDate:
      faker.helpers.maybe(() => faker.date.future().toISOString().slice(0, 10), {
        probability: 0.7,
      }) ?? null,
    expirationEstimated: faker.datatype.boolean(),
    addedBy,
    addedAt: faker.date.recent(),
    updatedAt: faker.date.recent(),
    notes: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.3 }) ?? null,
    ...overrides,
  }),

  /**
   * Generate a test product cache entry
   */
  productCache: (
    overrides?: Partial<{
      upc: string;
      name: string;
      brand: string | null;
      category: string | null;
      imageUrl: string | null;
      source: "open_food_facts" | "manual" | "kroger" | "trader_joes";
      fetchedAt: Date;
    }>
  ) => ({
    upc: faker.string.numeric(12),
    name: faker.commerce.productName(),
    brand: faker.company.name(),
    category: faker.commerce.department(),
    imageUrl: faker.image.url(),
    source: "open_food_facts" as const,
    fetchedAt: faker.date.recent(),
    ...overrides,
  }),

  /**
   * Generate multiple items for a household
   */
  items: (householdId: string, addedBy: string, count: number = 5) => {
    return Array.from({ length: count }, () => factories.item(householdId, addedBy));
  },

  /**
   * Household LLM settings row (meal planning). `apiKeyCiphertext` etc. are left null
   * by default — callers that need a real decryptable secret should encrypt one via
   * `encryptSecret()` (lib/crypto.ts) and pass the resulting fields as overrides, since
   * encryption is async and factories here stay synchronous.
   */
  llmSettings: (
    householdId: string,
    overrides?: Partial<{
      provider: "openai" | "openrouter" | "anthropic";
      model: string;
      apiKeyCiphertext: string | null;
      apiKeyIv: string | null;
      apiKeyTag: string | null;
      apiKeyLast4: string | null;
      apiKeyFingerprint: string | null;
      kekVersion: number;
      defaultServings: number;
      allergies: string[];
      dietaryRestrictions: string[];
      weekStartDay: number;
      timezone: string;
    }>
  ) => ({
    householdId,
    provider: "openai" as const,
    model: "gpt-4o-mini",
    apiKeyCiphertext: null,
    apiKeyIv: null,
    apiKeyTag: null,
    apiKeyLast4: null,
    apiKeyFingerprint: null,
    kekVersion: 1,
    defaultServings: 2,
    weekStartDay: 1,
    timezone: "America/New_York",
    allergies: [] as string[],
    dietaryRestrictions: [] as string[],
    ...overrides,
  }),

  /**
   * A meal_plans row (Phase 2 generation). `promptSnapshot`/`providerSnapshot`/
   * `modelSnapshot` are frozen at insert time in real routes — tests inserting rows
   * directly must supply them explicitly, same as the route does.
   */
  mealPlan: (
    householdId: string,
    requestedBy: string,
    overrides?: Partial<{
      id: string;
      startDate: string;
      dayCount: number;
      mode: "balanced" | "expiring_first";
      includeExpired: boolean;
      status:
        | "queued"
        | "generating_skeleton"
        | "generating_recipes"
        | "ready"
        | "failed"
        | "cancelled";
      progressDone: number;
      progressTotal: number;
      promptSnapshot: string;
      providerSnapshot: string;
      modelSnapshot: string;
      heartbeatAt: Date | null;
    }>
  ) => ({
    id: faker.string.uuid(),
    householdId,
    startDate: "2026-03-02",
    dayCount: 1,
    mode: "balanced" as const,
    includeExpired: false,
    status: "ready" as const,
    progressDone: 1,
    progressTotal: 1,
    promptSnapshot: "Plan {{DAYS}} day(s) for {{HOUSEHOLD}}.\n{{PANTRY}}",
    providerSnapshot: "openai",
    modelSnapshot: "gpt-4o-mini",
    requestedBy,
    heartbeatAt: faker.date.recent(),
    ...overrides,
  }),

  mealPlanDay: (
    householdId: string,
    planId: string,
    overrides?: Partial<{ id: string; dayIndex: number; date: string }>
  ) => ({
    id: faker.string.uuid(),
    householdId,
    planId,
    dayIndex: 0,
    date: "2026-03-02",
    ...overrides,
  }),

  mealPlanMeal: (
    householdId: string,
    planId: string,
    dayId: string,
    overrides?: Partial<{
      id: string;
      slot: "breakfast" | "lunch" | "dinner" | "snack";
      sortOrder: number;
      title: string;
      summary: string | null;
      servings: number | null;
      detailStatus: "pending" | "ready" | "failed";
    }>
  ) => ({
    id: faker.string.uuid(),
    householdId,
    planId,
    dayId,
    slot: "dinner" as const,
    sortOrder: 2,
    title: faker.commerce.productName(),
    summary: faker.lorem.sentence(),
    servings: 2,
    detailStatus: "ready" as const,
    ...overrides,
  }),

  mealPlanIngredient: (
    householdId: string,
    mealId: string,
    overrides?: Partial<{
      id: string;
      rawText: string;
      nameNormalized: string;
      quantity: string | null;
      unit: string | null;
      source: "pantry" | "purchase" | "staple";
      sourceOverridden: boolean;
      matchedItemId: string | null;
      shoppingListItemId: string | null;
      sortOrder: number;
    }>
  ) => ({
    id: faker.string.uuid(),
    householdId,
    mealId,
    rawText: "1 unit onion",
    nameNormalized: "onion",
    quantity: "1",
    unit: "unit",
    preparation: null,
    optional: false,
    source: "purchase" as const,
    sourceOverridden: false,
    matchedItemId: null,
    shoppingListItemId: null,
    matchConfidence: null,
    sortOrder: 0,
    ...overrides,
  }),

  mealPlanPrompt: (
    householdId: string,
    overrides?: Partial<{
      id: string;
      name: string;
      body: string;
      isDefault: boolean;
      updatedBy: string | null;
    }>
  ) => ({
    id: faker.string.uuid(),
    householdId,
    name: "My prompt",
    body: "Plan {{DAYS}} day(s) for {{HOUSEHOLD}}.\n{{PANTRY}}",
    isDefault: false,
    updatedBy: null,
    ...overrides,
  }),

  /**
   * Generate a complete household with users and items
   */
  householdWithData: (itemCount: number = 10) => {
    const household = factories.household();
    const user1 = factories.user(household.id);
    const user2 = factories.user(household.id);
    const items = factories.items(household.id, user1.id, itemCount);

    return {
      household,
      users: [user1, user2],
      items,
    };
  },
};
