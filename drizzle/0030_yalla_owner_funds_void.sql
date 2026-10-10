-- Clifford's answers of 10 Oct (master v4). Additive; existing rows keep today's behaviour.
-- deposits.kind: adds 'owner_funds' - an owner's own money the company holds (e.g. Bonnita's Garden Retreat Airbnb
--   net, held in PayPal): owed to the owner, never company income (Lists & Sources "Owed to owners").
-- accounting_transactions.payment_status: adds 'void' - a cancelled / withdrawn entry kept for the record (never
--   hard-deleted) and counted nowhere (e.g. the Lofts 603 2,250 direct booking and its 2,250 refund).
ALTER TABLE "deposits" DROP CONSTRAINT IF EXISTS "deposits_kind_check";--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_kind_check" CHECK ("kind" IN ('asset','liability','owner_funds'));--> statement-breakpoint
ALTER TABLE "accounting_transactions" DROP CONSTRAINT IF EXISTS "accounting_transactions_payment_status_chk";--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD CONSTRAINT "accounting_transactions_payment_status_chk" CHECK ("payment_status" IS NULL OR "payment_status" IN ('paid','pending','unpaid','none','void'));
