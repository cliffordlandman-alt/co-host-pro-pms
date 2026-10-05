ALTER TABLE "properties" ALTER COLUMN "bathrooms" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "airbnb_snapshot" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "beds" integer;