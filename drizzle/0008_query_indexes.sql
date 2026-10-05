CREATE INDEX IF NOT EXISTS reservations_property_dates_idx ON reservations(property_id, check_in, check_out);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reservations_check_out_idx ON reservations(check_out);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cleaning_tasks_reservation_idx ON cleaning_tasks(reservation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cleaning_tasks_scheduled_idx ON cleaning_tasks(scheduled_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payments_reservation_idx ON payments(reservation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS accounting_transactions_property_date_idx ON accounting_transactions(property_id, date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS owner_statements_property_month_idx ON owner_statements(property_id, month);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS airbnb_earnings_code_idx ON airbnb_earnings(confirmation_code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_type_entity_idx ON notifications(type, entity_id);
