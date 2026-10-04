-- Historical Airbnb bookings and owners paid directly by Airbnb (Lakeside, 4 Oct 2026).
-- reservations.airbnb_payout: the exact amount Airbnb paid out for the booking (its host payout), from Airbnb's
-- files; null = not known. property_settings.payout_to_owner: Airbnb pays the whole host payout straight to the
-- owner's bank, so statements show it as already paid to the owner. airbnb_booking_payouts: when, where and how
-- Airbnb paid each booking (one row per payout part; a USD PayPal transfer keeps its USD amount, never added to
-- the booking's currency). owners.auto_statements / auto_send: monthly automatic statements, off by default.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "airbnb_payout" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "property_settings" ADD COLUMN IF NOT EXISTS "payout_to_owner" boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "airbnb_booking_payouts" (
  "id" serial PRIMARY KEY NOT NULL,
  "reservation_id" integer NOT NULL REFERENCES "reservations"("id"),
  "confirmation_code" text NOT NULL,
  "part" integer NOT NULL,
  "paid_on" text,
  "amount" numeric(12, 2),
  "currency" text NOT NULL,
  "paid_to" text,
  "sent_amount" numeric(12, 2),
  "sent_currency" text,
  "reference" text,
  "file_name" text,
  "imported_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "airbnb_booking_payouts_part_unique" ON "airbnb_booking_payouts" ("reservation_id", "part");--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN IF NOT EXISTS "auto_statements" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "owners" ADD COLUMN IF NOT EXISTS "auto_send" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "owner_statements" ADD COLUMN IF NOT EXISTS "auto_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "owner_statements" ADD COLUMN IF NOT EXISTS "emailed_at" timestamp;
