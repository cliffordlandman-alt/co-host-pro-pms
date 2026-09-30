import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const templatesTable = pgTable("templates", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id"),
  trigger: text("trigger").notNull().default("booking_created"),
  offsetHours: integer("offset_hours").notNull().default(0),
  name: text("name").notNull(),
  category: text("category").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  channel: text("channel").notNull().default("whatsapp"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTemplateSchema = createInsertSchema(templatesTable).omit({ id: true, createdAt: true });
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templatesTable.$inferSelect;
