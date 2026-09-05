import { z } from "zod";

// Item schemas
export const itemLocationSchema = z.enum(["pantry", "fridge", "freezer"]);

export const itemSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  houseId: z.string().uuid().nullable().optional(),
  name: z.string().min(1, "Name is required"),
  brand: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  location: itemLocationSchema,
  quantity: z.number().positive().default(1),
  unit: z.string().nullable().optional(),
  barcodeUpc: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  expirationDate: z.coerce.date().nullable().optional(),
  expirationEstimated: z.boolean().default(false),
  opened: z.boolean().default(false),
  addedBy: z.string().uuid(),
  addedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  notes: z.string().nullable().optional(),
});

export const createItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  houseId: z.string().uuid().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  location: itemLocationSchema,
  quantity: z.coerce.number().positive().default(1),
  unit: z.string().optional(),
  barcodeUpc: z.string().optional(),
  imageUrl: z.string().optional(),
  expirationDate: z.coerce.date().nullable().optional(),
  expirationEstimated: z.boolean().default(false),
  opened: z.boolean().default(false),
  notes: z.string().optional(),
});

// Defined explicitly without defaults so a PUT with missing fields
// doesn't silently overwrite existing values with schema defaults (Zod 4 behaviour change).
export const updateItemSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  location: itemLocationSchema.optional(),
  quantity: z.coerce.number().positive().optional(),
  unit: z.string().optional(),
  barcodeUpc: z.string().optional(),
  imageUrl: z.string().optional(),
  expirationDate: z.coerce.date().nullable().optional(),
  expirationEstimated: z.boolean().optional(),
  opened: z.boolean().optional(),
  notes: z.string().optional(),
});

// Pagination query params (e.g. GET /items?page=2&pageSize=10). Both are optional —
// callers that omit them get the endpoint's own "no pagination requested" behavior
// (see route implementations), while explicit values are always coerced/validated here.
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

// House schemas
export const houseSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  name: z.string().min(1),
  createdAt: z.coerce.date(),
});

export const createHouseSchema = z.object({
  name: z.string().min(1, "House name is required").max(40),
});

export const updateHouseSchema = z.object({
  name: z.string().min(1, "House name is required").max(40),
});

// Household schemas
export const householdSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Household name is required"),
  inviteCode: z.string(),
  createdAt: z.coerce.date(),
});

export const createHouseholdSchema = z.object({
  name: z.string().min(1, "Household name is required"),
});

// User schemas
export const userSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  displayName: z.string().min(1, "Display name is required"),
  email: z.string().email(),
  createdAt: z.coerce.date(),
});

// Product cache schemas
export const productCacheSchema = z.object({
  upc: z.string(),
  name: z.string(),
  brand: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  source: z.enum(["open_food_facts", "manual", "kroger", "trader_joes"]),
  fetchedAt: z.coerce.date(),
});

// Receipt processing schemas
export const receiptMatchedProductSchema = z.object({
  name: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  imageUrl: z.string().optional(),
});

export const receiptLineItemSchema = z.object({
  raw: z.string(),
  decoded: z.string(),
  confidence: z.number().min(0).max(1),
  quantity: z.number().optional(),
  price: z.number().optional(),
  matchedProduct: receiptMatchedProductSchema.optional(),
});

export const receiptProcessingResultSchema = z.object({
  storeName: z.string().optional(),
  lineItems: z.array(receiptLineItemSchema),
  total: z.number().optional(),
});

// Barcode product schemas
export const barcodeProductSchema = z.object({
  upc: z.string(),
  name: z.string(),
  brand: z.string().optional(),
  category: z.string().optional(),
  imageUrl: z.string().url().optional(),
  source: z.enum(["open_food_facts", "manual", "kroger", "trader_joes"]).optional(),
  estimatedExpirationDays: z.number().optional(),
  estimatedExpirationLabel: z.string().optional(),
});

// Product search result schema (from /api/products/search)
export const productPriceSchema = z.object({
  regular: z.number(),
  promo: z.number().optional(),
  currency: z.string(),
});

export const productSearchResultSchema = z.object({
  upc: z.string().optional(),
  name: z.string().nullable(),
  brand: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  source: z.enum(["open_food_facts", "manual", "kroger", "trader_joes"]),
  confidence: z.number().min(0).max(1),
  price: productPriceSchema.optional(),
  stock: z.enum(["high", "low", "out"]).optional(),
});

// Store search result schema (from /api/stores/search)
export const storeSearchResultSchema = z.object({
  locationId: z.string(),
  name: z.string(),
  chain: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  zipCode: z.string(),
});

// Household store settings update schema
export const updateHouseholdSettingsSchema = z.object({
  krogerLocationId: z.string().nullable().optional(),
  krogerStoreName: z.string().nullable().optional(),
  krogerChain: z.string().nullable().optional(),
  krogerZipCode: z.string().nullable().optional(),
});

// Expiration estimation schemas
export const expirationEstimateSchema = z.object({
  days: z.number().int().positive(),
  label: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

// API response schemas
export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
  });

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

// Sync queue schemas
export const syncQueueEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["create", "update", "delete"]),
  tableName: z.string(),
  recordId: z.string(),
  data: z.unknown(),
  createdAt: z.coerce.date(),
  synced: z.boolean(),
});

// Shopping list schemas
export const shoppingListStatusSchema = z.enum(["pending", "purchased"]);

export const shoppingListItemSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  name: z.string().min(1),
  brand: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  suggestedQty: z.number().positive().default(1),
  sourceItemId: z.string().uuid().nullable().optional(),
  status: shoppingListStatusSchema,
  addedBy: z.string(),
  addedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createShoppingListItemSchema = z.object({
  name: z.string().min(1),
  brand: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  suggestedQty: z.coerce.number().positive().default(1),
  sourceItemId: z.string().uuid().optional(),
});

export const updateShoppingListItemSchema = z.object({
  status: shoppingListStatusSchema.optional(),
});

// LLM settings schemas (meal planning — Phase 1)
export const llmProviderSchema = z.enum(["openai", "openrouter", "anthropic"]);

// Model IDs are free text (the provider validates the real value); this only bounds
// length and character set. See docs/plans/meal-planning.md §5.6.
export const llmModelIdSchema = z
  .string()
  .min(1, "Model is required")
  .max(100)
  .regex(/^[a-zA-Z0-9._/-]{1,100}$/, "Invalid model id");

// GET /api/settings/llm response. Note: never includes the API key — keyConfigured
// and keyLast4 are the only key-related fields. provider/model are null until the
// household has saved settings at least once.
//
// keySource tells the frontend WHICH key would be used (container-wide env default vs
// a household-saved key, plan §4.5) without ever exposing the env key itself: it is
// null only when neither is available (keyConfigured is then also false). keyLast4
// stays household-only — always null when keySource is "env".
export const llmSettingsSchema = z.object({
  provider: llmProviderSchema.nullable(),
  model: llmModelIdSchema.nullable(),
  // Household override for the receipt-OCR vision model id — separate from `model`
  // above, which is chat/text-generation only (see resolveVisionModel in
  // server/src/lib/openai.ts). Null means "no household override configured".
  visionModel: llmModelIdSchema.nullable(),
  keyConfigured: z.boolean(),
  keySource: z.enum(["household", "env"]).nullable(),
  keyLast4: z.string().nullable(),
  defaultServings: z.number().int().positive().max(20),
  allergies: z.array(z.string().max(60)),
  dietaryRestrictions: z.array(z.string().max(60)),
  weekStartDay: z.number().int().min(0).max(6),
  timezone: z.string().min(1).max(64),
  // The operator's container-wide LLM_PROVIDER/LLM_MODEL, surfaced so the frontend can
  // pre-fill a household that has never opened Settings (provider/model both null
  // above). Never gates on whether a matching API key is actually configured — a
  // household may bring its own key for the operator's chosen provider — and NEVER
  // carries the env API key itself, only the provider/model pair (plan §5.6 problem 2).
  envDefaults: z.object({
    provider: llmProviderSchema.nullable(),
    model: z.string().nullable(),
    // What receipt OCR would fall back to for vision (LLM_VISION_MODEL, else the
    // per-provider default map) if the household never configures its own
    // `visionModel`. Never carries key material, same as `model` above.
    visionModel: z.string().nullable(),
  }),
});

// PUT /api/settings/llm request. `apiKey` omitted keeps the existing stored key;
// `apiKey: null` explicitly clears it. This mirrors the null-vs-undefined precedent in
// apps/web/src/lib/api.ts's `CreateItemDto.expirationDate` (null = "clear this value",
// undefined = "no change") — see server/src/routes/settings.ts for the three-case
// handling this enables.
export const updateLlmSettingsSchema = z.object({
  provider: llmProviderSchema,
  model: llmModelIdSchema,
  apiKey: z.string().min(1).max(500).nullable().optional(),
  // Same null-vs-undefined precedent as `apiKey` above: omitted keeps the existing
  // household override unchanged; `null` explicitly clears it back to
  // LLM_VISION_MODEL / the per-provider default (see routes/settings.ts PUT handler
  // and lib/openai.ts's resolveVisionModel precedence chain).
  visionModel: llmModelIdSchema.nullable().optional(),
  defaultServings: z.number().int().positive().max(20).optional(),
  allergies: z.array(z.string().max(60)).max(30).optional(),
  dietaryRestrictions: z.array(z.string().max(60)).max(30).optional(),
  weekStartDay: z.number().int().min(0).max(6).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

// POST /api/settings/llm/test request — all fields optional so the button can test
// either an unsaved in-progress form value or the currently saved settings.
export const testLlmSettingsSchema = z.object({
  apiKey: z.string().min(1).max(500).optional(),
  provider: llmProviderSchema.optional(),
  model: llmModelIdSchema.optional(),
});

export const llmTestErrorSchema = z.enum([
  "invalid_key",
  "provider_unavailable",
  "rate_limited",
  "timeout",
]);

export const llmTestResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  error: llmTestErrorSchema.optional(),
});

// GET /api/settings/llm/models response — a LIVE catalogue fetched from the provider's
// own /models endpoint (plan §5.6), replacing what used to be a hardcoded, rotting
// list. `models` is suggestions only: the model field on the settings form stays free
// text (`llmModelIdSchema`'s regex), so a model missing from this list is never
// blocked. `reason` explains an empty array without ever surfacing raw provider error
// text (plan §6.2) — `null` means the fetch succeeded (an empty `models` array with a
// null reason is possible too, if the provider's catalogue itself is empty).
export const llmModelsReasonSchema = z.enum([
  "no_api_key",
  "invalid_key",
  "provider_unavailable",
  "rate_limited",
  "timeout",
]);

export const llmModelsResponseSchema = z.object({
  provider: llmProviderSchema,
  models: z.array(z.string()),
  reason: llmModelsReasonSchema.nullable(),
});

// Meal planning schemas (Phase 2 — generation, docs/plans/meal-planning.md §3, §4.4)

// `start_date`/day `date` columns are Postgres `date` (no time component). The plan is
// explicit (§3): "local-date string math, never toISOString" — a coerced JS Date would
// reintroduce exactly the UTC-shift-by-a-day bug the plan warns about at week
// boundaries, so these stay plain YYYY-MM-DD strings end to end rather than
// z.coerce.date() like the timestamp-backed fields below.
export const localDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a local date (YYYY-MM-DD)");

export const mealSlotSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

export const mealPlanModeSchema = z.enum(["balanced", "expiring_first"]);

export const mealPlanStatusSchema = z.enum([
  "queued",
  "generating_skeleton",
  "generating_recipes",
  "ready",
  "failed",
  "cancelled",
]);

export const mealPlanDetailStatusSchema = z.enum(["pending", "ready", "failed"]);

// Fixed terminal generation-failure codes a plan row can carry (server/src/lib/mealplan/generate.ts,
// plan §4.5, §5.5, §6.2). `rate_limited` is distinct from `provider_unavailable`: it is only set
// when withRetry's backoff was exhausted AND the final failure was itself a 429 — a sustained
// outage that happens to end on a 5xx still maps to `provider_unavailable`.
export const mealPlanErrorCodeSchema = z.enum([
  "invalid_api_key",
  "provider_unavailable",
  "rate_limited",
  "unparseable_output",
  "timeout",
  "cancelled",
  "interrupted",
  // An unexpected bug in OUR code (DB constraint violation, null deref, etc.), never a
  // provider response — kept distinct from `provider_unavailable` so that code stays
  // reserved for genuine provider failures (server/src/lib/mealplan/generate.ts).
  "internal_error",
]);

export const ingredientSourceSchema = z.enum(["pantry", "purchase", "staple"]);

export const mealPlanIngredientSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  mealId: z.string().uuid(),
  rawText: z.string().min(1),
  nameNormalized: z.string().min(1),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  preparation: z.string().nullable(),
  optional: z.boolean(),
  source: ingredientSourceSchema,
  // The user can manually flip have<->buy; that override is persisted (plan §3).
  sourceOverridden: z.boolean(),
  matchedItemId: z.string().uuid().nullable(),
  shoppingListItemId: z.string().uuid().nullable(),
  matchConfidence: z.number().min(0).max(1).nullable(),
  sortOrder: z.number().int(),
});

export const mealPlanMealSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  planId: z.string().uuid(),
  dayId: z.string().uuid(),
  slot: mealSlotSchema,
  sortOrder: z.number().int(),
  title: z.string().min(1),
  summary: z.string().nullable(),
  servings: z.number().int().positive().nullable(),
  prepMinutes: z.number().int().nonnegative().nullable(),
  cookMinutes: z.number().int().nonnegative().nullable(),
  // string[], rendered whole, never individually mutated (plan §3).
  instructions: z.array(z.string()),
  detailStatus: mealPlanDetailStatusSchema,
  detailError: z.string().nullable(),
  // Present on GET /api/meal-plans/:id (nested); absent on list/summary responses.
  ingredients: z.array(mealPlanIngredientSchema).optional(),
});

export const mealPlanDaySchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  planId: z.string().uuid(),
  dayIndex: z.number().int().min(0).max(13),
  date: localDateStringSchema,
  // Present on GET /api/meal-plans/:id (nested); absent on list/summary responses.
  meals: z.array(mealPlanMealSchema).optional(),
});

// A meal_plans row. `days` is populated only by GET /api/meal-plans/:id — the list
// endpoint (GET /api/meal-plans) returns summaries with `days` omitted (plan §4.4).
export const mealPlanSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  startDate: localDateStringSchema,
  dayCount: z.number().int().min(1).max(14),
  mode: mealPlanModeSchema,
  includeExpired: z.boolean(),
  status: mealPlanStatusSchema,
  progressDone: z.number().int().nonnegative(),
  progressTotal: z.number().int().nonnegative(),
  promptId: z.string().uuid().nullable(),
  // Frozen at generation time; never rewritten by later settings edits (plan §3, §4.5).
  providerSnapshot: z.string(),
  modelSnapshot: z.string(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  generationMs: z.number().int().nonnegative().nullable(),
  priorityCoverage: z.number().min(0).max(1).nullable(),
  errorCode: mealPlanErrorCodeSchema.nullable(),
  errorMessage: z.string().nullable(),
  // Only ever non-null when errorCode === "rate_limited" and the provider's final 429
  // carried a parseable Retry-After header (plan §5.5: "retry in Ns").
  errorRetryAfterSeconds: z.number().int().nonnegative().nullable(),
  // users.id is text, not uuid — see llmSettingsSchema note above and plan §4.4.
  requestedBy: z.string(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  days: z.array(mealPlanDaySchema).optional(),
});

// POST /api/meal-plans request body (plan §4.4, §11.1). At least one slot is required;
// the generate-controls UI defaults the checkbox row to `["dinner"]`. `startDate` is
// optional — when omitted, the server defaults it to the household's configured
// week start (`week_start_day` + `timezone`, never a past date; see
// lib/mealplan/schedule.ts) instead of always meaning "today".
export const createMealPlanSchema = z.object({
  startDate: localDateStringSchema.optional(),
  dayCount: z.number().int().min(1).max(14),
  slots: z
    .array(mealSlotSchema)
    .min(1, "Select at least one meal slot")
    .max(4)
    .refine((slots) => new Set(slots).size === slots.length, "Duplicate slots are not allowed"),
  mode: mealPlanModeSchema,
  promptId: z.string().uuid().optional(),
  includeExpired: z.boolean().default(false),
  notes: z.string().max(500).optional(),
});

// PATCH /api/meal-plans/:id/ingredients/:ingId — flip an ingredient between have/buy.
export const updateMealPlanIngredientSchema = z.object({
  source: ingredientSourceSchema,
});

// GET /api/meal-plans/:id/shopping response shapes (plan §4.4, §5.4). Aggregation
// groups ingredients by `${nameNormalized}|${unit}`; mixed-unit quantities are rendered
// as a display string ("2 cups + 1 unit") rather than a fabricated conversion, so
// `quantityLabel` is pre-formatted text, not a bare number.
export const mealPlanShoppingStateSchema = z.enum(["have", "have_expiring", "must_buy"]);

export const mealPlanShoppingUsedOnSchema = z.object({
  dayIndex: z.number().int().min(0).max(13),
  recipeId: z.string().uuid(),
  recipeTitle: z.string(),
});

export const mealPlanShoppingAggregateSchema = z.object({
  nameNormalized: z.string().min(1),
  unit: z.string().nullable(),
  quantityLabel: z.string(),
  state: mealPlanShoppingStateSchema,
  ingredientIds: z.array(z.string().uuid()).min(1),
  usedOn: z.array(mealPlanShoppingUsedOnSchema),
  alreadyCommitted: z.boolean(),
});

export const mealPlanShoppingListSchema = z.object({
  planId: z.string().uuid(),
  items: z.array(mealPlanShoppingAggregateSchema),
});

// POST /api/meal-plans/:id/shopping/commit — omitted ingredientIds commits everything
// eligible (plan §4.4).
export const commitMealPlanShoppingSchema = z.object({
  ingredientIds: z.array(z.string().uuid()).min(1).optional(),
});

// meal_plan_prompts CRUD (plan §3, §4.4, §5.6). `updatedBy` is text (users.id), not
// uuid — same rationale as `requestedBy` above.
export const mealPlanPromptSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  name: z.string().min(1),
  body: z.string().min(1).max(8000),
  isDefault: z.boolean(),
  updatedBy: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createMealPlanPromptSchema = z.object({
  name: z.string().min(1).max(120),
  body: z.string().min(1, "Prompt body is required").max(8000),
  isDefault: z.boolean().optional(),
});

// Defined explicitly without defaults (Zod 4), same rationale as updateItemSchema.
export const updateMealPlanPromptSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  body: z.string().min(1, "Prompt body is required").max(8000).optional(),
  isDefault: z.boolean().optional(),
});

export type ItemLocation = z.infer<typeof itemLocationSchema>;
export type Item = z.infer<typeof itemSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type Household = z.infer<typeof householdSchema>;
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type User = z.infer<typeof userSchema>;
export type ProductCache = z.infer<typeof productCacheSchema>;
export type ReceiptMatchedProduct = z.infer<typeof receiptMatchedProductSchema>;
export type ReceiptLineItem = z.infer<typeof receiptLineItemSchema>;
export type ReceiptProcessingResult = z.infer<typeof receiptProcessingResultSchema>;
export type BarcodeProduct = z.infer<typeof barcodeProductSchema>;
export type ProductSearchResult = z.infer<typeof productSearchResultSchema>;
export type ProductPrice = z.infer<typeof productPriceSchema>;
export type ExpirationEstimate = z.infer<typeof expirationEstimateSchema>;
export type SyncQueueEntry = z.infer<typeof syncQueueEntrySchema>;
export type ShoppingListStatus = z.infer<typeof shoppingListStatusSchema>;
export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;
export type CreateShoppingListItemInput = z.infer<typeof createShoppingListItemSchema>;
export type UpdateShoppingListItemInput = z.infer<typeof updateShoppingListItemSchema>;
export type StoreSearchResult = z.infer<typeof storeSearchResultSchema>;
export type UpdateHouseholdSettingsInput = z.infer<typeof updateHouseholdSettingsSchema>;
export type House = z.infer<typeof houseSchema>;
export type CreateHouseInput = z.infer<typeof createHouseSchema>;
export type UpdateHouseInput = z.infer<typeof updateHouseSchema>;
export type LLMProvider = z.infer<typeof llmProviderSchema>;
export type LlmSettings = z.infer<typeof llmSettingsSchema>;
export type UpdateLlmSettingsInput = z.infer<typeof updateLlmSettingsSchema>;
export type TestLlmSettingsInput = z.infer<typeof testLlmSettingsSchema>;
export type LlmTestError = z.infer<typeof llmTestErrorSchema>;
export type LlmTestResult = z.infer<typeof llmTestResultSchema>;
export type LlmModelsReason = z.infer<typeof llmModelsReasonSchema>;
export type LlmModelsResponse = z.infer<typeof llmModelsResponseSchema>;

export type MealSlot = z.infer<typeof mealSlotSchema>;
export type MealPlanMode = z.infer<typeof mealPlanModeSchema>;
export type MealPlanStatus = z.infer<typeof mealPlanStatusSchema>;
export type MealPlanDetailStatus = z.infer<typeof mealPlanDetailStatusSchema>;
export type IngredientSource = z.infer<typeof ingredientSourceSchema>;
export type MealPlanIngredient = z.infer<typeof mealPlanIngredientSchema>;
export type MealPlanMeal = z.infer<typeof mealPlanMealSchema>;
export type MealPlanDay = z.infer<typeof mealPlanDaySchema>;
export type MealPlan = z.infer<typeof mealPlanSchema>;
export type CreateMealPlanInput = z.infer<typeof createMealPlanSchema>;
export type UpdateMealPlanIngredientInput = z.infer<typeof updateMealPlanIngredientSchema>;
export type MealPlanShoppingState = z.infer<typeof mealPlanShoppingStateSchema>;
export type MealPlanShoppingUsedOn = z.infer<typeof mealPlanShoppingUsedOnSchema>;
export type MealPlanShoppingAggregate = z.infer<typeof mealPlanShoppingAggregateSchema>;
export type MealPlanShoppingList = z.infer<typeof mealPlanShoppingListSchema>;
export type CommitMealPlanShoppingInput = z.infer<typeof commitMealPlanShoppingSchema>;
export type MealPlanPrompt = z.infer<typeof mealPlanPromptSchema>;
export type CreateMealPlanPromptInput = z.infer<typeof createMealPlanPromptSchema>;
export type UpdateMealPlanPromptInput = z.infer<typeof updateMealPlanPromptSchema>;

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
