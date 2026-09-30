import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { propertiesTable, ownersTable } from "./properties";
import { reservationsTable } from "./reservations";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("other"),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  reservationId: integer("reservation_id").references(() => reservationsTable.id),
  ownerId: integer("owner_id").references(() => ownersTable.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("pending"),
  description: text("description"),
  dueDate: text("due_date"),
  paidAt: text("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
