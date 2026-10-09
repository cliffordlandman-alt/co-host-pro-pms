-- YALLA workbook, Raju's last round (9 Oct). Additive; existing rows keep today's behaviour.
-- accounting_transactions.report_description: the wording on Expense Input / Income Input (the master's); null = the
--   description. The full description (invoice refs) stays in the app and on Expense Line Items.
-- accounting_transactions.report_order: fixed position among the rows of the same date on Expense / Income Input
--   (1 = first); null = after them, in the usual order.
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "report_description" text;--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "report_order" integer;
