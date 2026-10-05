import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  clientName: text("client_name").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  plan: text("plan").notNull().default("standard"),
  propertyCount: integer("property_count").notNull().default(1),
  monthlyAmount: integer("monthly_amount").notNull().default(49),
  status: text("status").notNull().default("trial"),
  billingDate: text("billing_date"),
  trialEndsAt: text("trial_ends_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
