-- Vrbo bookings need their own channel commission rate now that the server (not the browser)
-- decides booking rates. Default 0 matches what Vrbo bookings used before.
ALTER TABLE "property_settings" ADD COLUMN IF NOT EXISTS "platform_fee_vrbo" numeric(5, 2) DEFAULT '0' NOT NULL;
