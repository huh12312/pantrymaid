import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  numeric,
  date,
  check,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Better Auth tables - required by better-auth library
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  name: text("name").notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
});

// Houses table — named locations within a household (e.g. "Main House", "Beach House")
export const houses = pgTable("houses", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Households table
export const households = pgTable("households", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  krogerLocationId: text("kroger_location_id"),
  krogerStoreName: text("kroger_store_name"),
  krogerChain: text("kroger_chain"),
  krogerZipCode: text("kroger_zip_code"),
});

// Users table - extends Better Auth users via household relationship
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }), // References Better Auth user.id
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Items table
export const items = pgTable(
  "items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    brand: text("brand"),
    category: text("category"),
    location: text("location").notNull(),
    quantity: numeric("quantity").default("1").notNull(),
    unit: text("unit"),
    houseId: uuid("house_id").references(() => houses.id, { onDelete: "set null" }),
    barcodeUpc: text("barcode_upc"),
    imageUrl: text("image_url"),
    expirationDate: date("expiration_date"),
    expirationEstimated: boolean("expiration_estimated").default(false).notNull(),
    addedBy: text("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    notes: text("notes"),
    opened: boolean("opened").default(false).notNull(),
  },
  (table) => ({
    locationCheck: check(
      "location_check",
      sql`${table.location} IN ('pantry', 'fridge', 'freezer')`
    ),
    // Supports the meal-planning expiring-soon inventory query (household_id +
    // expiration_date range scan).
    householdExpirationIdx: index("items_household_id_expiration_date_idx").on(
      table.householdId,
      table.expirationDate
    ),
    // Trigram index for tier-3 fuzzy ingredient-name matching (pg_trgm similarity()).
    nameTrgmIdx: index("items_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
  })
);

// Product cache table
export const productCache = pgTable("product_cache", {
  upc: text("upc").primaryKey(),
  name: text("name"),
  brand: text("brand"),
  category: text("category"),
  imageUrl: text("image_url"),
  source: text("source").notNull(), // 'open_food_facts' | 'manual' | 'kroger' | 'trader_joes'
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

// Shopping list items table
export const shoppingListItems = pgTable(
  "shopping_list_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    brand: text("brand"),
    category: text("category"),
    unit: text("unit"),
    suggestedQty: numeric("suggested_qty").default("1").notNull(),
    sourceItemId: uuid("source_item_id").references(() => items.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    addedBy: text("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    // 'manual' | 'meal_plan' | 'restock'. Nullable — NULL is treated as 'manual' in
    // code so existing rows don't need a backfill. Lets the shopping UI badge rows
    // pushed from a meal plan (see docs/plans/meal-planning.md §3).
    origin: text("origin"),
  },
  (table) => ({
    statusCheck: check(
      "shopping_list_status_check",
      sql`${table.status} IN ('pending', 'purchased')`
    ),
  })
);

// Postgres-backed generation rate-limit counters — 1:1 with households. Replaces the
// process-local in-memory limiter for anything protecting a paid LLM call (plan §6.5):
// a deploy or crash must not refill a household's quota. Two independent rolling
// windows (hourly, daily) are checked and incremented atomically under a row lock —
// see server/src/lib/generationLimits.ts.
export const householdGenerationLimits = pgTable("household_generation_limits", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  hourlyWindowStart: timestamp("hourly_window_start", { withTimezone: true })
    .notNull()
    .defaultNow(),
  hourlyCount: integer("hourly_count").notNull().default(0),
  dailyWindowStart: timestamp("daily_window_start", { withTimezone: true })
    .notNull()
    .defaultNow(),
  dailyCount: integer("daily_count").notNull().default(0),
});

// Household LLM settings — 1:1 with households. Holds the BYO provider/model choice
// and the household's envelope-encrypted API key (see server/src/lib/crypto.ts).
// The api_key_* columns are ciphertext/metadata only; GET routes must never spread
// this row into a response (see routes/settings.ts's explicit field allow-list).
export const householdLlmSettings = pgTable(
  "household_llm_settings",
  {
    householdId: uuid("household_id")
      .primaryKey()
      .references(() => households.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    // Household override for the receipt-OCR vision model id (plan §3, §4.4). Nullable —
    // null means "fall back to LLM_VISION_MODEL, then the per-provider default map, then
    // the legacy fully-env-driven path" (see resolveVisionModel in lib/openai.ts). Unlike
    // `model` above, this is NEVER used for chat/text generation — receipt OCR only.
    visionModel: text("vision_model"),
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyIv: text("api_key_iv"),
    apiKeyTag: text("api_key_tag"),
    apiKeyLast4: text("api_key_last4"),
    apiKeyFingerprint: text("api_key_fingerprint"),
    kekVersion: integer("kek_version").notNull().default(1),
    defaultServings: integer("default_servings").notNull().default(2),
    allergies: jsonb("allergies").$type<string[]>().notNull().default([]),
    dietaryRestrictions: jsonb("dietary_restrictions").$type<string[]>().notNull().default([]),
    weekStartDay: integer("week_start_day").notNull().default(1), // ISO, 1 = Monday
    timezone: text("timezone").notNull().default("America/New_York"),
    monthlyTokenCap: integer("monthly_token_cap"), // null = uncapped
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    providerCheck: check(
      "household_llm_settings_provider_check",
      sql`${table.provider} IN ('openai', 'openrouter', 'anthropic')`
    ),
  })
);

// User-editable meal-plan prompt templates. The active default is appended below an
// immutable base system prompt at generation time (see plan §2.5) — never a full
// replacement.
export const mealPlanPrompts = pgTable(
  "meal_plan_prompts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    body: text("body").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    bodyLengthCheck: check(
      "meal_plan_prompts_body_length_check",
      sql`length(${table.body}) <= 8000`
    ),
    oneDefaultPerHousehold: uniqueIndex("meal_plan_prompts_one_default_idx")
      .on(table.householdId)
      .where(sql`${table.isDefault} = true`),
  })
);

// A generated week of meals for a household. `prompt_snapshot`/`provider_snapshot`/
// `model_snapshot` freeze the exact inputs used at generation time so a later edit to
// the prompt template or provider settings never rewrites history (plan §4.5,
// "Regeneration"). The two partial unique indexes below are the real concurrency and
// dedup guarantees — see docs/plans/meal-planning.md §3 and §4.1.
export const mealPlans = pgTable(
  "meal_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    // Local-date string math, never toISOString() — see plan §3.
    startDate: date("start_date").notNull(),
    dayCount: integer("day_count").notNull(),
    mode: text("mode").notNull(),
    includeExpired: boolean("include_expired").notNull().default(false),
    status: text("status").notNull(),
    progressDone: integer("progress_done").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    promptId: uuid("prompt_id").references(() => mealPlanPrompts.id, { onDelete: "set null" }),
    promptSnapshot: text("prompt_snapshot").notNull(),
    providerSnapshot: text("provider_snapshot").notNull(),
    modelSnapshot: text("model_snapshot").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    generationMs: integer("generation_ms"),
    // Fraction of the priority (expiring/opened) ingredient set actually used by the
    // generated plan; null until generation completes. See plan §4.3.
    priorityCoverage: numeric("priority_coverage"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    // Only ever populated when errorCode = 'rate_limited' and the provider's final 429
    // carried a parseable Retry-After header — a clamped integer, never provider text
    // (plan §5.5, §6.2).
    errorRetryAfterSeconds: integer("error_retry_after_seconds"),
    // Bumped after each completed meal; the boot/60s sweep fails any generating_* row
    // whose heartbeat is stale (plan §4.1).
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    dayCountCheck: check("meal_plans_day_count_check", sql`${table.dayCount} BETWEEN 1 AND 14`),
    modeCheck: check("meal_plans_mode_check", sql`${table.mode} IN ('balanced', 'expiring_first')`),
    statusCheck: check(
      "meal_plans_status_check",
      sql`${table.status} IN ('queued', 'generating_skeleton', 'generating_recipes', 'ready', 'failed', 'cancelled')`
    ),
    // The real concurrency guarantee (plan §4.1): two household members racing a
    // generation request get one plan, not two. A concurrent second INSERT fails with
    // 23505, which the route translates to 409.
    oneActiveIdx: uniqueIndex("meal_plans_one_active_idx")
      .on(table.householdId)
      .where(sql`${table.status} IN ('queued', 'generating_skeleton', 'generating_recipes')`),
    onePerWeekIdx: uniqueIndex("meal_plans_one_per_week_idx")
      .on(table.householdId, table.startDate)
      .where(sql`${table.status} = 'ready'`),
    householdStartDateIdx: index("meal_plans_household_id_start_date_idx").on(
      table.householdId,
      sql`${table.startDate} DESC`
    ),
  })
);

// One row per calendar day within a plan.
export const mealPlanDays = pgTable(
  "meal_plan_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    dayIndex: integer("day_index").notNull(),
    date: date("date").notNull(),
  },
  (table) => ({
    planDayIdx: uniqueIndex("meal_plan_days_plan_id_day_index_idx").on(
      table.planId,
      table.dayIndex
    ),
  })
);

// One row per meal slot within a day. `instructions` is JSONB (string[]) — never
// individually queried or mutated, always rendered whole (plan §3). `detailStatus`
// tracks phase-2 (per-meal recipe detail) generation independently of the parent
// plan's status, so one failed meal never invalidates the rest (plan §4.1).
export const mealPlanMeals = pgTable(
  "meal_plan_meals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    dayId: uuid("day_id")
      .notNull()
      .references(() => mealPlanDays.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    title: text("title").notNull(),
    summary: text("summary"),
    servings: integer("servings"),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    instructions: jsonb("instructions").$type<string[]>().notNull().default([]),
    detailStatus: text("detail_status").notNull().default("pending"),
    detailError: text("detail_error"),
  },
  (table) => ({
    slotCheck: check(
      "meal_plan_meals_slot_check",
      sql`${table.slot} IN ('breakfast', 'lunch', 'dinner', 'snack')`
    ),
    detailStatusCheck: check(
      "meal_plan_meals_detail_status_check",
      sql`${table.detailStatus} IN ('pending', 'ready', 'failed')`
    ),
    dayIdSortOrderIdx: index("meal_plan_meals_day_id_sort_order_idx").on(
      table.dayId,
      table.sortOrder
    ),
  })
);

// One row per ingredient per meal. `raw_text` is built in code from
// quantity/unit/preparation/name — never asked of the model directly (plan §3).
// `matched_item_id`/`shopping_list_item_id` are ON DELETE SET NULL, not CASCADE:
// consuming a pantry item or checking off a shopping row must not delete plan history.
export const mealPlanIngredients = pgTable(
  "meal_plan_ingredients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    mealId: uuid("meal_id")
      .notNull()
      .references(() => mealPlanMeals.id, { onDelete: "cascade" }),
    rawText: text("raw_text").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    quantity: numeric("quantity"),
    unit: text("unit"),
    preparation: text("preparation"),
    optional: boolean("optional").notNull().default(false),
    source: text("source").notNull(),
    // The user can manually flip any ingredient between have and buy; that override is
    // stored here so a future regeneration/reconciliation doesn't clobber it.
    sourceOverridden: boolean("source_overridden").notNull().default(false),
    matchedItemId: uuid("matched_item_id").references(() => items.id, { onDelete: "set null" }),
    shoppingListItemId: uuid("shopping_list_item_id").references(() => shoppingListItems.id, {
      onDelete: "set null",
    }),
    matchConfidence: numeric("match_confidence"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => ({
    sourceCheck: check(
      "meal_plan_ingredients_source_check",
      sql`${table.source} IN ('pantry', 'purchase', 'staple')`
    ),
    mealIdIdx: index("meal_plan_ingredients_meal_id_idx").on(table.mealId),
    shoppingListItemIdIdx: index("meal_plan_ingredients_shopping_list_item_id_idx").on(
      table.shoppingListItemId
    ),
  })
);

// Relations
export const householdsRelations = relations(households, ({ many }) => ({
  users: many(users),
  items: many(items),
  houses: many(houses),
}));

export const housesRelations = relations(houses, ({ one, many }) => ({
  household: one(households, {
    fields: [houses.householdId],
    references: [households.id],
  }),
  items: many(items),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  household: one(households, {
    fields: [users.householdId],
    references: [households.id],
  }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one }) => ({
  household: one(households, {
    fields: [items.householdId],
    references: [households.id],
  }),
  house: one(houses, {
    fields: [items.houseId],
    references: [houses.id],
  }),
  addedByUser: one(users, {
    fields: [items.addedBy],
    references: [users.id],
  }),
}));

export const shoppingListItemsRelations = relations(shoppingListItems, ({ one }) => ({
  household: one(households, {
    fields: [shoppingListItems.householdId],
    references: [households.id],
  }),
  addedByUser: one(users, {
    fields: [shoppingListItems.addedBy],
    references: [users.id],
  }),
  sourceItem: one(items, {
    fields: [shoppingListItems.sourceItemId],
    references: [items.id],
  }),
}));

export const householdLlmSettingsRelations = relations(householdLlmSettings, ({ one }) => ({
  household: one(households, {
    fields: [householdLlmSettings.householdId],
    references: [households.id],
  }),
  updatedByUser: one(users, {
    fields: [householdLlmSettings.updatedBy],
    references: [users.id],
  }),
}));

export const mealPlanPromptsRelations = relations(mealPlanPrompts, ({ one, many }) => ({
  household: one(households, {
    fields: [mealPlanPrompts.householdId],
    references: [households.id],
  }),
  updatedByUser: one(users, {
    fields: [mealPlanPrompts.updatedBy],
    references: [users.id],
  }),
  plans: many(mealPlans),
}));

export const mealPlansRelations = relations(mealPlans, ({ one, many }) => ({
  household: one(households, {
    fields: [mealPlans.householdId],
    references: [households.id],
  }),
  prompt: one(mealPlanPrompts, {
    fields: [mealPlans.promptId],
    references: [mealPlanPrompts.id],
  }),
  requestedByUser: one(users, {
    fields: [mealPlans.requestedBy],
    references: [users.id],
  }),
  days: many(mealPlanDays),
  meals: many(mealPlanMeals),
}));

export const mealPlanDaysRelations = relations(mealPlanDays, ({ one, many }) => ({
  household: one(households, {
    fields: [mealPlanDays.householdId],
    references: [households.id],
  }),
  plan: one(mealPlans, {
    fields: [mealPlanDays.planId],
    references: [mealPlans.id],
  }),
  meals: many(mealPlanMeals),
}));

export const mealPlanMealsRelations = relations(mealPlanMeals, ({ one, many }) => ({
  household: one(households, {
    fields: [mealPlanMeals.householdId],
    references: [households.id],
  }),
  plan: one(mealPlans, {
    fields: [mealPlanMeals.planId],
    references: [mealPlans.id],
  }),
  day: one(mealPlanDays, {
    fields: [mealPlanMeals.dayId],
    references: [mealPlanDays.id],
  }),
  ingredients: many(mealPlanIngredients),
}));

export const mealPlanIngredientsRelations = relations(mealPlanIngredients, ({ one }) => ({
  household: one(households, {
    fields: [mealPlanIngredients.householdId],
    references: [households.id],
  }),
  meal: one(mealPlanMeals, {
    fields: [mealPlanIngredients.mealId],
    references: [mealPlanMeals.id],
  }),
  matchedItem: one(items, {
    fields: [mealPlanIngredients.matchedItemId],
    references: [items.id],
  }),
  shoppingListItem: one(shoppingListItems, {
    fields: [mealPlanIngredients.shoppingListItemId],
    references: [shoppingListItems.id],
  }),
}));
