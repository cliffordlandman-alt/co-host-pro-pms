-- YALLA workbook, Raju's answers of 9 Oct (round 5). Additive; existing rows keep today's behaviour.
-- accounting_transactions.report_property: Income Input Property text for an income row with no property (e.g. 'Company'); null = 'Various'.
-- accounting_transactions.forecast_label: Forecast one-off label (A18) for a pending income row; null = its description.
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "report_property" text;--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "forecast_label" text;
