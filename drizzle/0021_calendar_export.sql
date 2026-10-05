-- Outbound calendar (iCal export) per property, and the health of each incoming channel calendar.
-- New tables only; no existing row is changed. Export links are created by the app (random 32-byte tokens).
CREATE TABLE IF NOT EXISTS "calendar_exports" (
  "id" serial PRIMARY KEY NOT NULL,
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "token" text NOT NULL,
  "include_channel_bookings" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "rotated_at" timestamp,
  "last_fetched_at" timestamp,
  "fetch_count" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_exports_property_unique" ON "calendar_exports" ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_exports_token_unique" ON "calendar_exports" ("token");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_sync_health" (
  "id" serial PRIMARY KEY NOT NULL,
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "platform" text NOT NULL,
  "last_attempt_at" timestamp,
  "last_success_at" timestamp,
  "last_error" text,
  "last_error_at" timestamp,
  "failing_since" timestamp,
  "alerted_at" timestamp,
  "last_summary" text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_sync_health_property_platform_unique" ON "channel_sync_health" ("property_id","platform");
