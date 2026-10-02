-- Co-host payout Airbnb deducted from a booking's payout (from the reservation breakdown). Recorded and
-- shown as "needs decision" only; no statement uses it yet. Null = not known (never treated as 0).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "cohost_payout" numeric(10, 2);
