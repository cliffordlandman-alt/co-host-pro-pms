import { pgTable, serial, text, integer, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { propertiesTable } from "./properties";
import { staffTable } from "./staff";
import { reservationsTable } from "./reservations";

export const cleaningTasksTable = pgTable("cleaning_tasks", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  reservationId: integer("reservation_id").references(() => reservationsTable.id),
  assignedToId: integer("assigned_to_id").references(() => staffTable.id),
  status: text("status").notNull().default("dirty"),
  scheduledDate: text("scheduled_date").notNull(),
  completedAt: text("completed_at"),
  photos: json("photos"),
  price: text("price"),
  scheduledTime: text("scheduled_time").default("11:00"),
  checklist: json("checklist"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCleaningTaskSchema = createInsertSchema(cleaningTasksTable).omit({ id: true, createdAt: true });
export type InsertCleaningTask = z.infer<typeof insertCleaningTaskSchema>;
export type CleaningTask = typeof cleaningTasksTable.$inferSelect;
