import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { propertiesTable } from "./properties";
import { reservationsTable } from "./reservations";

export const reviewsTable = pgTable("reviews", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  reservationId: integer("reservation_id").references(() => reservationsTable.id),
  guestName: text("guest_name").notNull(),
  platform: text("platform").notNull().default("airbnb"),
  rating: numeric("rating", { precision: 3, scale: 1 }).notNull(),
  comment: text("comment"),
  response: text("response"),
  reviewDate: text("review_date").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertReviewSchema = createInsertSchema(reviewsTable).omit({ id: true, createdAt: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviewsTable.$inferSelect;
