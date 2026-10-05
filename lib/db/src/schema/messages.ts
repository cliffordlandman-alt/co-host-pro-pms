import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reservationsTable } from "./reservations";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").notNull().references(() => reservationsTable.id),
  sender: text("sender").notNull().default("guest"),
  body: text("body").notNull(),
  readAt: text("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
