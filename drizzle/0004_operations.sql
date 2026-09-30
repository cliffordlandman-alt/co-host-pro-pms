ALTER TABLE reservations ADD COLUMN guest_email text, ADD COLUMN guest_phone text, ADD COLUMN id_collected boolean NOT NULL DEFAULT false, ADD COLUMN channel_percent numeric(5,2), ADD COLUMN channel_amount numeric(10,2), ADD COLUMN tourism_rate numeric(10,2);
--> statement-breakpoint
ALTER TABLE property_settings ADD COLUMN tourism_rate numeric(10,2) NOT NULL DEFAULT 10, ADD COLUMN tourism_enabled boolean NOT NULL DEFAULT true, ADD COLUMN vat_enabled boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE owner_statements ADD COLUMN tourism_fee numeric(10,2) NOT NULL DEFAULT 0, ADD COLUMN booking_details text, ADD COLUMN currency text NOT NULL DEFAULT 'AED';
--> statement-breakpoint
ALTER TABLE cleaning_tasks ADD COLUMN photos json, ADD COLUMN price text, ADD COLUMN scheduled_time text DEFAULT '11:00';
