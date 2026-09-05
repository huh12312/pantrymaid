CREATE TABLE IF NOT EXISTS "household_generation_limits" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"hourly_window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"hourly_count" integer DEFAULT 0 NOT NULL,
	"daily_window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"daily_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_generation_limits" ADD CONSTRAINT "household_generation_limits_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;