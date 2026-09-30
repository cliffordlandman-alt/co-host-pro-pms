CREATE TABLE "import_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_url" text NOT NULL,
	"listing_id" text,
	"property_id" integer,
	"user_id" text,
	"status" text NOT NULL,
	"imported_fields" text,
	"failed_fields" text,
	"error_message" text,
	"photos_imported" text DEFAULT 'no' NOT NULL,
	"bookings_imported" text DEFAULT 'no' NOT NULL,
	"prices_imported" text DEFAULT 'no' NOT NULL,
	"amenities_imported" text DEFAULT 'no' NOT NULL,
	"calendar_connected" text DEFAULT 'no' NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit_number" text NOT NULL,
	"building" text,
	"area" text,
	"owner_id" integer,
	"bedroom_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"airbnb_ical_url" text,
	"booking_com_ical_url" text,
	"vrbo_ical_url" text,
	"airbnb_listing_id" text,
	"booking_com_property_id" text,
	"vrbo_listing_id" text,
	"description" text,
	"photos" text,
	"amenities" text,
	"bedrooms" integer,
	"bathrooms" integer,
	"guest_capacity" integer,
	"listing_url" text,
	"check_in_instructions" text,
	"wifi_details" text,
	"access_details" text,
	"cleaning_fee" text,
	"management_fee" text,
	"imported_owner_name" text,
	"imported_owner_email" text,
	"base_nightly_price" text,
	"house_rules" text,
	"property_type" text,
	"city" text,
	"country" text,
	"import_status" text,
	"airbnb_channel_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text DEFAULT 'cleaner' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"guest_name" text NOT NULL,
	"platform" text DEFAULT 'direct' NOT NULL,
	"property_id" integer NOT NULL,
	"check_in" text NOT NULL,
	"check_out" text NOT NULL,
	"nights" integer DEFAULT 1 NOT NULL,
	"revenue" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cleaning_fee" numeric(10, 2),
	"balance_due" numeric(10, 2),
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cleaning_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"reservation_id" integer,
	"assigned_to_id" integer,
	"status" text DEFAULT 'dirty' NOT NULL,
	"scheduled_date" text NOT NULL,
	"completed_at" text,
	"checklist" json,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"issue" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assigned_to_id" integer,
	"cost" numeric(10, 2),
	"charge_type" text,
	"status" text DEFAULT 'reported' NOT NULL,
	"notes" text,
	"photos" text,
	"quote_amount" numeric(10, 2),
	"quoted_by" text,
	"owner_approval" text,
	"completed_at" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"property_id" integer,
	"reservation_id" integer,
	"owner_id" integer,
	"amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"description" text,
	"due_date" text,
	"paid_at" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"reservation_id" integer,
	"guest_name" text NOT NULL,
	"platform" text DEFAULT 'airbnb' NOT NULL,
	"rating" numeric(3, 1) NOT NULL,
	"comment" text,
	"response" text,
	"review_date" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservation_id" integer NOT NULL,
	"sender" text DEFAULT 'guest' NOT NULL,
	"body" text NOT NULL,
	"read_at" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"property_id" integer,
	"reservation_id" integer,
	"type" text DEFAULT 'expense' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"month" text NOT NULL,
	"gross_revenue" numeric(10, 2) DEFAULT '0' NOT NULL,
	"platform_fees" numeric(10, 2) DEFAULT '0' NOT NULL,
	"management_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cleaning_costs" numeric(10, 2) DEFAULT '0' NOT NULL,
	"maintenance_costs" numeric(10, 2) DEFAULT '0' NOT NULL,
	"other_expenses" numeric(10, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"owner_payout" numeric(10, 2) DEFAULT '0' NOT NULL,
	"nights_occupied" integer DEFAULT 0 NOT NULL,
	"bookings_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" text,
	"paid_at" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"management_fee_percent" numeric(5, 2) DEFAULT '20' NOT NULL,
	"platform_fee_airbnb" numeric(5, 2) DEFAULT '3' NOT NULL,
	"platform_fee_booking_com" numeric(5, 2) DEFAULT '15' NOT NULL,
	"platform_fee_direct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"owner_split_percent" numeric(5, 2) DEFAULT '80' NOT NULL,
	"vat_percent" numeric(5, 2) DEFAULT '5' NOT NULL,
	"include_cleaning" boolean DEFAULT true NOT NULL,
	"include_maintenance" boolean DEFAULT true NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "property_settings_property_id_unique" UNIQUE("property_id")
);
--> statement-breakpoint
CREATE TABLE "owner_otp" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"action" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" json,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"link" text,
	"entity_type" text,
	"entity_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" json,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"property_id" integer,
	"entity_type" text,
	"entity_id" text,
	"file_url" text,
	"file_size" text,
	"expiry_date" text,
	"status" text DEFAULT 'valid' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"plan" text DEFAULT 'starter' NOT NULL,
	"property_count" integer DEFAULT 1 NOT NULL,
	"monthly_amount" integer DEFAULT 299 NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"billing_date" text,
	"trial_ends_at" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'manager' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"avatar" text,
	"phone" text,
	"assigned_properties" json DEFAULT '[]'::json,
	"permissions" json DEFAULT '{}'::json,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "yallaready_analyses" (
	"analysis_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"room_type" text NOT NULL,
	"budget" integer NOT NULL,
	"score_before" integer NOT NULL,
	"score_after" integer NOT NULL,
	"result_json" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yallaready_trial_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" varchar(50) NOT NULL,
	"entity" varchar(50) NOT NULL,
	"entity_id" integer NOT NULL,
	"details" text,
	"performed_by" varchar(255) DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool" varchar(80) NOT NULL,
	"prompt" text,
	"result" text,
	"model" varchar(50) DEFAULT 'gpt-4o-mini',
	"input_tokens" integer,
	"output_tokens" integer,
	"property_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_email" varchar(255),
	"user_name" varchar(255),
	"user_role" varchar(50),
	"started_at" timestamp DEFAULT now(),
	"last_seen_at" timestamp DEFAULT now(),
	"ended_at" timestamp,
	"duration_seconds" integer,
	"ip_address" varchar(100)
);
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_assigned_to_id_staff_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_assigned_to_id_staff_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD CONSTRAINT "accounting_transactions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD CONSTRAINT "accounting_transactions_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_settings" ADD CONSTRAINT "property_settings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_otp" ADD CONSTRAINT "owner_otp_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;