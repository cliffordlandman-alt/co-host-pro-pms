-- Money you can prove: payout records per owner statement (date, method, bank reference) and the lines of
-- imported Airbnb payout files for the payout check. Statements already marked paid get one payout record each,
-- taken from the owner payout already on the Payouts list, with method "not_recorded" (nothing is invented).
CREATE TABLE IF NOT EXISTS "owner_payouts" (
  "id" serial PRIMARY KEY NOT NULL,
  "statement_id" integer NOT NULL REFERENCES "owner_statements"("id"),
  "property_id" integer NOT NULL REFERENCES "properties"("id"),
  "owner_id" integer,
  "amount" numeric(12, 2) NOT NULL,
  "currency" text NOT NULL,
  "paid_on" text NOT NULL,
  "method" text NOT NULL,
  "reference" text,
  "notes" text,
  "payment_id" integer REFERENCES "payments"("id"),
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "owner_payouts_statement_idx" ON "owner_payouts" ("statement_id");--> statement-breakpoint
INSERT INTO "owner_payouts" ("statement_id", "property_id", "owner_id", "amount", "currency", "paid_on", "method", "payment_id", "notes")
SELECT s."id", s."property_id", s."owner_id", p."amount", COALESCE(s."currency", 'AED'), COALESCE(p."paid_at", s."paid_at", to_char(s."created_at", 'YYYY-MM-DD')), 'not_recorded', p."id", 'Marked paid before payout records; method and reference were not recorded'
FROM "owner_statements" s
JOIN "payments" p ON p."type" = 'owner_payout' AND p."description" LIKE 'Owner statement #' || s."id" || ' ·%'
WHERE s."status" = 'paid' AND NOT EXISTS (SELECT 1 FROM "owner_payouts" o WHERE o."statement_id" = s."id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "airbnb_payout_lines" (
  "id" text PRIMARY KEY NOT NULL,
  "source" text NOT NULL,
  "kind" text NOT NULL,
  "confirmation_code" text,
  "listing" text,
  "guest_name" text,
  "check_in" text,
  "check_out" text,
  "currency" text NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "cohost_payout" numeric(14, 2),
  "cohost_basis" text,
  "cohost_to" text,
  "guest_paid" numeric(14, 2),
  "payout_date" text,
  "status" text NOT NULL,
  "reference" text,
  "destination" text,
  "notes" text,
  "file_name" text,
  "imported_at" timestamp DEFAULT now() NOT NULL
);
