-- Dubai compliance pack: permit record per unit, filed returns, and DTCM guest registration per booking.
-- New tables and one nullable column; no existing row is changed. A booking with no registration status set
-- shows a status worked out from the booking (Airbnb: verified by Airbnb; other Dubai bookings: pending).
CREATE TABLE IF NOT EXISTS "property_permits" (
  "id" serial PRIMARY KEY NOT NULL,
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "dtcm_permit_number" text,
  "dtcm_class" text,
  "permit_issue_date" text,
  "permit_expiry_date" text,
  "oa_noc_reference" text,
  "oa_noc_expiry_date" text,
  "insurance_reference" text,
  "insurance_expiry_date" text,
  "ejari_number" text,
  "ejari_expiry_date" text,
  "notes" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "property_permits_property_unique" ON "property_permits" ("property_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_filings" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "period" text NOT NULL,
  "filed_on" text NOT NULL,
  "reference" text,
  "filed_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_filings_kind_period_unique" ON "compliance_filings" ("kind","period");--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "dtcm_registration" text;
--> statement-breakpoint
-- "Confirmed" ticks in Fee settings for the Tourism Dirham rate and the VAT position (open decisions; off for all).
ALTER TABLE "property_settings" ADD COLUMN IF NOT EXISTS "tourism_confirmed" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "property_settings" ADD COLUMN IF NOT EXISTS "vat_confirmed" boolean NOT NULL DEFAULT false;
