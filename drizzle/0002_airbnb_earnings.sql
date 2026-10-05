ALTER TABLE reservations ADD COLUMN external_id text;
--> statement-breakpoint
CREATE UNIQUE INDEX reservations_external_id_unique ON reservations(external_id);
--> statement-breakpoint
CREATE TABLE airbnb_earnings (
 id text PRIMARY KEY,
 confirmation_code text NOT NULL,
 property_id integer NOT NULL REFERENCES properties(id),
 guest_name text NOT NULL,
 check_in text NOT NULL,
 check_out text NOT NULL,
 kind text NOT NULL,
 currency text NOT NULL,
 amount numeric(14,2) NOT NULL,
 status text NOT NULL,
 payout_id text,
 source_date text NOT NULL,
 imported_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE airbnb_payouts (
 id text PRIMARY KEY,
 currency text NOT NULL,
 amount numeric(14,2) NOT NULL,
 source_date text NOT NULL,
 imported_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
