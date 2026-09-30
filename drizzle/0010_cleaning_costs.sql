-- Cleaning is company income (the booking's cleaning fee) and a company expense (what the external
-- cleaning company charges per checkout clean). This adds the vendor, the rate card, a per-property
-- override and a one-expense-per-cleaning-task link.
CREATE TABLE IF NOT EXISTS vendors (
  id serial PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'cleaning',
  email text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO vendors (name, kind) SELECT 'Cleaning company', 'cleaning' WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE kind = 'cleaning');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cleaning_cost_rates (
  id serial PRIMARY KEY,
  bedrooms integer NOT NULL UNIQUE,
  amount numeric(10, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'AED',
  updated_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Current cleaning-company rate card (AED per checkout clean). 0 = studio.
INSERT INTO cleaning_cost_rates (bedrooms, amount) VALUES (0, 140), (1, 180), (2, 250), (3, 290), (4, 350) ON CONFLICT (bedrooms) DO NOTHING;
--> statement-breakpoint
ALTER TABLE property_settings ADD COLUMN IF NOT EXISTS cleaning_cost_override numeric(10, 2);
--> statement-breakpoint
ALTER TABLE accounting_transactions ADD COLUMN IF NOT EXISTS vendor_id integer REFERENCES vendors(id);
--> statement-breakpoint
ALTER TABLE accounting_transactions ADD COLUMN IF NOT EXISTS cleaning_task_id integer REFERENCES cleaning_tasks(id);
--> statement-breakpoint
-- At most one cleaning expense per cleaning task (the column is new, so there are no duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS accounting_transactions_cleaning_task_uq ON accounting_transactions(cleaning_task_id);
