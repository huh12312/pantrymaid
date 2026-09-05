CREATE TABLE IF NOT EXISTS "meal_plan_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meal_plan_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"meal_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"name_normalized" text NOT NULL,
	"quantity" numeric,
	"unit" text,
	"preparation" text,
	"optional" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"source_overridden" boolean DEFAULT false NOT NULL,
	"matched_item_id" uuid,
	"shopping_list_item_id" uuid,
	"match_confidence" numeric,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "meal_plan_ingredients_source_check" CHECK ("meal_plan_ingredients"."source" IN ('pantry', 'purchase', 'staple'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meal_plan_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"day_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"servings" integer,
	"prep_minutes" integer,
	"cook_minutes" integer,
	"instructions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detail_status" text DEFAULT 'pending' NOT NULL,
	"detail_error" text,
	CONSTRAINT "meal_plan_meals_slot_check" CHECK ("meal_plan_meals"."slot" IN ('breakfast', 'lunch', 'dinner', 'snack')),
	CONSTRAINT "meal_plan_meals_detail_status_check" CHECK ("meal_plan_meals"."detail_status" IN ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"day_count" integer NOT NULL,
	"mode" text NOT NULL,
	"include_expired" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"prompt_id" uuid,
	"prompt_snapshot" text NOT NULL,
	"provider_snapshot" text NOT NULL,
	"model_snapshot" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"generation_ms" integer,
	"priority_coverage" numeric,
	"error_code" text,
	"error_message" text,
	"heartbeat_at" timestamp with time zone,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "meal_plans_day_count_check" CHECK ("meal_plans"."day_count" BETWEEN 1 AND 14),
	CONSTRAINT "meal_plans_mode_check" CHECK ("meal_plans"."mode" IN ('balanced', 'expiring_first')),
	CONSTRAINT "meal_plans_status_check" CHECK ("meal_plans"."status" IN ('queued', 'generating_skeleton', 'generating_recipes', 'ready', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "meal_plan_days" ADD CONSTRAINT "meal_plan_days_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_days" ADD CONSTRAINT "meal_plan_days_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_ingredients" ADD CONSTRAINT "meal_plan_ingredients_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_ingredients" ADD CONSTRAINT "meal_plan_ingredients_meal_id_meal_plan_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meal_plan_meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_ingredients" ADD CONSTRAINT "meal_plan_ingredients_matched_item_id_items_id_fk" FOREIGN KEY ("matched_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_ingredients" ADD CONSTRAINT "meal_plan_ingredients_shopping_list_item_id_shopping_list_items_id_fk" FOREIGN KEY ("shopping_list_item_id") REFERENCES "public"."shopping_list_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_meals" ADD CONSTRAINT "meal_plan_meals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_meals" ADD CONSTRAINT "meal_plan_meals_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_meals" ADD CONSTRAINT "meal_plan_meals_day_id_meal_plan_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."meal_plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_prompt_id_meal_plan_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."meal_plan_prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meal_plan_days_plan_id_day_index_idx" ON "meal_plan_days" USING btree ("plan_id","day_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_plan_ingredients_meal_id_idx" ON "meal_plan_ingredients" USING btree ("meal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_plan_ingredients_shopping_list_item_id_idx" ON "meal_plan_ingredients" USING btree ("shopping_list_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_plan_meals_day_id_sort_order_idx" ON "meal_plan_meals" USING btree ("day_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meal_plans_one_active_idx" ON "meal_plans" USING btree ("household_id") WHERE "meal_plans"."status" IN ('queued', 'generating_skeleton', 'generating_recipes');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meal_plans_one_per_week_idx" ON "meal_plans" USING btree ("household_id","start_date") WHERE "meal_plans"."status" = 'ready';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_plans_household_id_start_date_idx" ON "meal_plans" USING btree ("household_id","start_date" DESC);