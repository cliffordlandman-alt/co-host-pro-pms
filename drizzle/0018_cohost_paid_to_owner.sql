-- Per property: Airbnb pays the co-host payout directly to the owner (the owner is the Airbnb co-host).
-- Owner statements then show the bookings' co-host payouts (reservations.cohost_payout, migration 0017) as
-- "Already paid to owner by Airbnb" and deduct them from the balance due. Off by default.
ALTER TABLE "property_settings" ADD COLUMN IF NOT EXISTS "cohost_paid_to_owner" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "owner_statements" ADD COLUMN IF NOT EXISTS "paid_by_airbnb" numeric(10, 2) NOT NULL DEFAULT '0';
