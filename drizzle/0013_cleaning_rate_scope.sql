-- Cleaning cost scope per property.
--   cleaning_rate_card: the property is cleaned by the rate-card cleaning company. When false and no
--     override is set, the property has "no rate set": its cleans are skipped and flagged, never guessed.
--   cleaning_cost_currency: currency of the override amount (blank = the property's currency).
-- Existing properties: the rate card (a Dubai cleaning company) applies to Dubai properties only.
ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS cleaning_rate_card boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS cleaning_cost_currency text;
--> statement-breakpoint
UPDATE property_settings s SET cleaning_rate_card = true
FROM properties p WHERE s.property_id = p.id AND (COALESCE(p.city, '') ~* 'dubai' OR COALESCE(p.area, '') ~* 'dubai');
--> statement-breakpoint
-- One automatic cleaning cost per checkout (booking), whether it was recorded when the clean was
-- completed or by the backfill for a past checkout without a cleaning task. Skipped (not deleted) if
-- duplicates already exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting_transactions WHERE reference LIKE 'cleaning:%' AND reservation_id IS NOT NULL
             GROUP BY reservation_id HAVING count(*) > 1) THEN
    RAISE NOTICE 'accounting_transactions: more than one automatic cleaning cost for a booking; per-booking unique index NOT created';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS accounting_transactions_cleaning_booking_unique
      ON accounting_transactions (reservation_id) WHERE reference LIKE 'cleaning:%' AND reservation_id IS NOT NULL;
  END IF;
END $$;
