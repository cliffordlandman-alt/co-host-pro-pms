ALTER TABLE accounting_transactions ADD COLUMN currency text NOT NULL DEFAULT 'AED';
--> statement-breakpoint
ALTER TABLE accounting_transactions ADD COLUMN allocation text NOT NULL DEFAULT 'owner';
--> statement-breakpoint
UPDATE accounting_transactions t SET currency = COALESCE(p.currency,'AED') FROM properties p WHERE t.property_id=p.id;
--> statement-breakpoint
UPDATE accounting_transactions SET allocation='company' WHERE property_id IS NULL;
