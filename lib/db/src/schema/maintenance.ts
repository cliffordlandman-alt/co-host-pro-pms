import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { propertiesTable } from "./properties";
import { staffTable } from "./staff";

export const maintenanceTicketsTable = pgTable("maintenance_tickets", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  issue: text("issue").notNull(),
  priority: text("priority").notNull().default("medium"),
  assignedToId: integer("assigned_to_id").references(() => staffTable.id),
  cost: numeric("cost", { precision: 10, scale: 2 }),
  chargeType: text("charge_type"),
  status: text("status").notNull().default("reported"),
  notes: text("notes"),
  photos: text("photos"),
  quoteAmount: numeric("quote_amount", { precision: 10, scale: 2 }),
  quotedBy: text("quoted_by"),
  ownerApproval: text("owner_approval"), // 'pending', 'approved', 'rejected'
  completedAt: text("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMaintenanceTicketSchema = createInsertSchema(maintenanceTicketsTable).omit({ id: true, createdAt: true });
export type InsertMaintenanceTicket = z.infer<typeof insertMaintenanceTicketSchema>;
export type MaintenanceTicket = typeof maintenanceTicketsTable.$inferSelect;
