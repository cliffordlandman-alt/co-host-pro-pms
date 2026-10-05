-- Optional "revenue stream" yes/no tag on manually entered expenses (null = not tagged).
ALTER TABLE "accounting_transactions" ADD COLUMN IF NOT EXISTS "revenue_stream" boolean;
