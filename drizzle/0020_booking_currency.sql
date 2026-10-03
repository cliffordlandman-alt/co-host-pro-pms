-- Booking currency. Null = the property's currency (every existing booking; nothing is backfilled).
-- When a property's currency is changed through the app, its bookings without a currency are stamped with the
-- old currency first, so an AED booking stays AED; bookings created afterwards (null) use the new currency.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "currency" text;
