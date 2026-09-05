CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "household_llm_settings" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"api_key_ciphertext" text,
	"api_key_iv" text,
	"api_key_tag" text,
	"api_key_last4" text,
	"api_key_fingerprint" text,
	"kek_version" integer DEFAULT 1 NOT NULL,
	"default_servings" integer DEFAULT 2 NOT NULL,
	"allergies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dietary_restrictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"week_start_day" integer DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"monthly_token_cap" integer,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_llm_settings_provider_check" CHECK ("household_llm_settings"."provider" IN ('openai', 'openrouter', 'anthropic'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meal_plan_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_plan_prompts_body_length_check" CHECK (length("meal_plan_prompts"."body") <= 8000)
);
--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD COLUMN IF NOT EXISTS "origin" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_household_id_expiration_date_idx" ON "items" ("household_id","expiration_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_name_trgm_idx" ON "items" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meal_plan_prompts_one_default_idx" ON "meal_plan_prompts" ("household_id") WHERE "is_default" = true;
--> statement-breakpoint
ALTER TABLE "household_llm_settings" ADD CONSTRAINT "household_llm_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_llm_settings" ADD CONSTRAINT "household_llm_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_prompts" ADD CONSTRAINT "meal_plan_prompts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_prompts" ADD CONSTRAINT "meal_plan_prompts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
