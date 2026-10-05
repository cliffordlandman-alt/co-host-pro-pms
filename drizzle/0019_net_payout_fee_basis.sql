-- Fee basis per property: 'gross' (standard: management % and channel % of net revenue) or 'net-payout'
-- (management % of the channel's net payout = guest total minus the channel's actual fees; the channel line is
-- those actual fees). Bookings record the actual channel fees from the booking breakdown and the basis they were
-- calculated on; statements record the basis they were generated with. Existing rows keep the standard basis.
ALTER TABLE "property_settings" ADD COLUMN IF NOT EXISTS "fee_basis" text NOT NULL DEFAULT 'gross';--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "channel_fees" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "fee_basis" text;--> statement-breakpoint
ALTER TABLE "owner_statements" ADD COLUMN IF NOT EXISTS "fee_basis" text;
