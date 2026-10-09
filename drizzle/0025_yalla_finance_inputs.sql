-- YALLA monthly workbook inputs (9 Oct 2026, approved by Clifford via Raju). Additive only: every new column is
-- nullable (null = the behaviour before this migration), every new table starts empty.
-- accounting_transactions.treatment: company | owner_paid | pass_through; null = follow allocation.
-- accounting_transactions.fx_rate: rate to AED for a non-AED entry (USD fixed 3.6725); null for AED and ZAR.
-- accounting_transactions.payment_status: paid | pending | unpaid; null = paid.
-- properties.report_name: the workbook's property name; null = the listing name.
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "treatment" text;--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "fx_rate" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "payment_status" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "accounting_transactions" ADD CONSTRAINT "accounting_transactions_treatment_chk" CHECK ("treatment" IS NULL OR "treatment" IN ('company','owner_paid','pass_through'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "accounting_transactions" ADD CONSTRAINT "accounting_transactions_payment_status_chk" CHECK ("payment_status" IS NULL OR "payment_status" IN ('paid','pending','unpaid'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "report_name" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lease_schedules" (
  "id" serial PRIMARY KEY NOT NULL,
  "property_id" integer REFERENCES "properties"("id"),
  "name" text NOT NULL,
  "landlord" text,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "annual_rent" numeric(12, 2) NOT NULL,
  "currency" text DEFAULT 'AED' NOT NULL,
  "agency_fee" numeric(12, 2),
  "agency_fee_date" text,
  "agency_fee_note" text,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lease_cheques" (
  "id" serial PRIMARY KEY NOT NULL,
  "lease_id" integer NOT NULL REFERENCES "lease_schedules"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "due_date" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "months" integer DEFAULT 3 NOT NULL,
  "paid_on" text,
  "reference" text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lease_cheques_seq_unique" ON "lease_cheques" ("lease_id", "seq");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deposits" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('asset','liability')),
  "property_id" integer REFERENCES "properties"("id"),
  "counterparty" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL CHECK ("amount" > 0),
  "currency" text DEFAULT 'AED' NOT NULL,
  "date" text NOT NULL,
  "method" text,
  "status" text DEFAULT 'held' NOT NULL CHECK ("status" IN ('held','refunded','kept')),
  "settled_on" text,
  "kept_amount" numeric(12, 2),
  "kept_reason" text,
  "lease_id" integer REFERENCES "lease_schedules"("id"),
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_balances" (
  "id" serial PRIMARY KEY NOT NULL,
  "account" text DEFAULT 'ADIB 19589605' NOT NULL,
  "month" text NOT NULL,
  "balance_date" text NOT NULL,
  "balance" numeric(14, 2) NOT NULL,
  "currency" text DEFAULT 'AED' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "notes" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_balances_account_month_unique" ON "bank_balances" ("account", "month");
