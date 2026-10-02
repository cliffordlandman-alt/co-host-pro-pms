import { pgTable, serial, text, integer, numeric, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { propertiesTable } from "./properties";

export const reservationsTable = pgTable("reservations", {
  id: serial("id").primaryKey(),
  guestEmail: text("guest_email"),
  guestPhone: text("guest_phone"),
  idCollected: boolean("id_collected").notNull().default(false),
  channelPercent: numeric("channel_percent", {precision:5,scale:2}),
  channelAmount: numeric("channel_amount", {precision:10,scale:2}),
  tourismRate: numeric("tourism_rate", {precision:10,scale:2}),
  // Channel id of the booking/event. Unique per property (feed), never globally: Airbnb reuses the same
  // "Not available" event UID across different listings, so a global key silently dropped blocks.
  externalId: text("external_id"),
  guestName: text("guest_name").notNull(),
  platform: text("platform").notNull().default("direct"),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  checkIn: text("check_in").notNull(),
  checkOut: text("check_out").notNull(),
  nights: integer("nights").notNull().default(1),
  revenue: numeric("revenue", { precision: 10, scale: 2 }).notNull().default("0"),
  cleaningFee: numeric("cleaning_fee", { precision: 10, scale: 2 }),
  balanceDue: numeric("balance_due", { precision: 10, scale: 2 }),
  grossAmount: numeric("gross_amount", { precision: 10, scale: 2 }),
  // Airbnb co-host payout deducted from this booking (needs a decision; not used by any statement yet).
  cohostPayout: numeric("cohost_payout", { precision: 10, scale: 2 }),
  managementPercent: numeric("management_percent", { precision: 5, scale: 2 }),
  managementAmount: numeric("management_amount", { precision: 10, scale: 2 }),
  tourismFee: numeric("tourism_fee", { precision: 10, scale: 2 }),
  vatAmount: numeric("vat_amount", { precision: 10, scale: 2 }),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
  ownerAmount: numeric("owner_amount", { precision: 10, scale: 2 }),
  tourismRooms: integer("tourism_rooms"),
  tourismNights: integer("tourism_nights"),
  financeMode: text("finance_mode"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  notes: text("notes"),
  status: text("status").notNull().default("confirmed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => [
  uniqueIndex("reservations_property_external_id_unique").on(t.propertyId, t.externalId),
  index("reservations_external_id_idx").on(t.externalId),
]);

export const insertReservationSchema = createInsertSchema(reservationsTable).omit({ id: true, createdAt: true });
export type InsertReservation = z.infer<typeof insertReservationSchema>;
export type Reservation = typeof reservationsTable.$inferSelect;
