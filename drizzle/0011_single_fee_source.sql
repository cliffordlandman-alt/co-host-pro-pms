-- One source of truth for the management % and the cleaning fee: the property's fee settings record
-- (property_settings). Bookings keep a deliberate snapshot of both (reservations.management_percent,
-- reservations.cleaning_fee) taken when the booking is calculated.
ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS cleaning_fee numeric(10, 2);
--> statement-breakpoint
-- Every property gets a fee settings record, with exactly the values that were in effect before:
-- properties without a record used management % from the property (default 20) and VAT/tourism on
-- only for Dubai properties. (Postgres LEAST ignores NULLs, hence the explicit COALESCE/CASE.)
INSERT INTO property_settings (property_id, tourism_enabled, vat_enabled, management_fee_percent, currency, cleaning_fee)
SELECT p.id,
       COALESCE(p.city, '') ~* 'dubai',
       COALESCE(p.city, '') ~* 'dubai',
       LEAST(COALESCE(substring(replace(trim(p.management_fee), ',', '') from '^[0-9]+(?:\.[0-9]+)?')::numeric, 20), 100),
       COALESCE(NULLIF(p.currency, ''), 'AED'),
       CASE WHEN substring(replace(trim(p.cleaning_fee), ',', '') from '^[0-9]+(?:\.[0-9]+)?')::numeric > 100000 THEN 100000 ELSE substring(replace(trim(p.cleaning_fee), ',', '') from '^[0-9]+(?:\.[0-9]+)?')::numeric END
FROM properties p
WHERE NOT EXISTS (SELECT 1 FROM property_settings s WHERE s.property_id = p.id);
--> statement-breakpoint
-- Existing fee records: bring over the property's cleaning fee (their management % already won).
UPDATE property_settings s
SET cleaning_fee = CASE WHEN substring(replace(trim(p.cleaning_fee), ',', '') from '^[0-9]+(?:\.[0-9]+)?')::numeric > 100000 THEN 100000 ELSE substring(replace(trim(p.cleaning_fee), ',', '') from '^[0-9]+(?:\.[0-9]+)?')::numeric END
FROM properties p
WHERE s.property_id = p.id AND s.cleaning_fee IS NULL AND p.cleaning_fee IS NOT NULL;
--> statement-breakpoint
-- Keep the old per-property text values untouched for reference, under names that make clear
-- they are no longer read or written by the app.
ALTER TABLE properties RENAME COLUMN cleaning_fee TO legacy_cleaning_fee;
--> statement-breakpoint
ALTER TABLE properties RENAME COLUMN management_fee TO legacy_management_fee;
--> statement-breakpoint
COMMENT ON COLUMN properties.legacy_cleaning_fee IS 'Pre-0011 copy, not used. Cleaning fee lives in property_settings.cleaning_fee.';
--> statement-breakpoint
COMMENT ON COLUMN properties.legacy_management_fee IS 'Pre-0011 copy, not used. Management % lives in property_settings.management_fee_percent.';
--> statement-breakpoint
COMMENT ON COLUMN property_settings.owner_split_percent IS 'Not used: the owner share is calculated from management_fee_percent.';
