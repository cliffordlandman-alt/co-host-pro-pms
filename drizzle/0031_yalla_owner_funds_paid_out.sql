-- deposits.status: adds 'paid_out' - owner money (kind owner_funds) paid to the owner (Clifford, 10 Oct: Bonnita paid).
ALTER TABLE "deposits" DROP CONSTRAINT IF EXISTS "deposits_status_check";--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_status_check" CHECK ("status" IN ('held','refunded','kept','paid_out'));
