-- YALLA workbook M4 + Raju's answers of 9 Oct (second round). Additive; existing rows keep today's behaviour.
-- properties.show_in_report: the property gets Airbnb Property Report rows even at zero (true, the default); off =
--   only when it has a non-zero amount (the master leaves 509 Blvd Central and Sunrise Bay 1406 out at zero).
-- bank_balances.kind: month_end (one per account and month, as before) or latest (one dated latest balance per
--   account, shown on the Dashboard like the master's "BANK BALANCE - ADIB - 9 OCT 2026").
-- accounting_transactions.report_source: the Income Input Source text (e.g. 'Workbook' for rows back-entered from it).
-- accounting_transactions.payment_status: adds 'none' (the workbook's Status left blank, as on some master rows).
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "show_in_report" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_balances" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'month_end' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bank_balances" ADD CONSTRAINT "bank_balances_kind_chk" CHECK ("kind" IN ('month_end','latest'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "bank_balances_account_month_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_balances_month_end_unique" ON "bank_balances" ("account", "month") WHERE "kind" = 'month_end';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_balances_latest_unique" ON "bank_balances" ("account") WHERE "kind" = 'latest';--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "report_source" text;--> statement-breakpoint
ALTER TABLE "accounting_transactions" DROP CONSTRAINT IF EXISTS "accounting_transactions_payment_status_chk";--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD CONSTRAINT "accounting_transactions_payment_status_chk" CHECK ("payment_status" IS NULL OR "payment_status" IN ('paid','pending','unpaid','none'));
