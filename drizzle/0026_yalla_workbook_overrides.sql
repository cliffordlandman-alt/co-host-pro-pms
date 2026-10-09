-- YALLA workbook M3 (9 Oct 2026, Raju's answers): mirror the master workbook row by row. Additive only; every new
-- column is nullable and null keeps the behaviour before this migration.
-- accounting_transactions.direct_cost: Direct Cost (AED) on an Income Input row (e.g. the 1 Sep Lofts West 603
--   direct booking 2,250 less 100); income only; null = 0.
-- accounting_transactions.payer: Owner / Payer on an Income Input row; null = the property's owner.
-- accounting_transactions.report_category: the master workbook's category for this row (Lists & Sources); null =
--   the default mapping from the entry's own category.
-- reservations.fee_received_on: date the booking's management fee was received (e.g. netted from an owner payout
--   that left the bank); the Income Input row then shows Received. Null = the statement / booking payment rule.
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "direct_cost" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "payer" text;--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "report_category" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "fee_received_on" text;
