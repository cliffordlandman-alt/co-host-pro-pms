import { pgTable, serial, text, integer, real, timestamp, json, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ownersTable = pgTable("owners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  /** Monthly automatic owner statements (generated on the 6th for the previous month). Off by default. */
  autoStatements: boolean("auto_statements").notNull().default(false),
  /** Email the automatic statement once approved months exist; needs an email and OUTBOUND_DELIVERY=on. Off by default. */
  autoSend: boolean("auto_send").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOwnerSchema = createInsertSchema(ownersTable).omit({ id: true, createdAt: true });
export type InsertOwner = z.infer<typeof insertOwnerSchema>;
export type Owner = typeof ownersTable.$inferSelect;

export const propertiesTable = pgTable("properties", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unitNumber: text("unit_number").notNull(),
  building: text("building"),
  area: text("area"),
  ownerId: integer("owner_id").references(() => ownersTable.id),
  bedroomType: text("bedroom_type"),
  status: text("status").notNull().default("active"),
  airbnbIcalUrl: text("airbnb_ical_url"),
  bookingComIcalUrl: text("booking_com_ical_url"),
  vrboIcalUrl: text("vrbo_ical_url"),
  airbnbListingId: text("airbnb_listing_id"),
  bookingComPropertyId: text("booking_com_property_id"),
  vrboListingId: text("vrbo_listing_id"),
  // Import-extended fields
  description: text("description"),
  photos: text("photos"),
  amenities: text("amenities"),
  bedrooms: integer("bedrooms"),
  bathrooms: real("bathrooms"),
  guestCapacity: integer("guest_capacity"),
  listingUrl: text("listing_url"),
  messageVariables: json("message_variables"),
  checkInInstructions: text("check_in_instructions"),
  wifiDetails: text("wifi_details"),
  accessDetails: text("access_details"),
  /** Pre-migration-0011 copies, kept for reference only and never read or written by the app.
   *  The live values are property_settings.cleaning_fee and property_settings.management_fee_percent. */
  legacyCleaningFee: text("legacy_cleaning_fee"),
  legacyManagementFee: text("legacy_management_fee"),
  importedOwnerName: text("imported_owner_name"),
  importedOwnerEmail: text("imported_owner_email"),
  airbnbSnapshot: text("airbnb_snapshot"),
  currency: text("currency"),
  beds: integer("beds"),
  // New import fields
  baseNightlyPrice: text("base_nightly_price"),
  houseRules: text("house_rules"),
  propertyType: text("property_type"),
  city: text("city"),
  country: text("country"),
  importStatus: text("import_status"),
  airbnbChannelStatus: text("airbnb_channel_status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPropertySchema = createInsertSchema(propertiesTable).omit({ id: true, createdAt: true, legacyCleaningFee: true, legacyManagementFee: true });
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof propertiesTable.$inferSelect;

export const importLogsTable = pgTable("import_logs", {
  id: serial("id").primaryKey(),
  listingUrl: text("listing_url").notNull(),
  listingId: text("listing_id"),
  propertyId: integer("property_id"),
  userId: text("user_id"),
  status: text("status").notNull(),
  importedFields: text("imported_fields"),
  failedFields: text("failed_fields"),
  errorMessage: text("error_message"),
  photosImported: text("photos_imported").notNull().default("no"),
  bookingsImported: text("bookings_imported").notNull().default("no"),
  pricesImported: text("prices_imported").notNull().default("no"),
  amenitiesImported: text("amenities_imported").notNull().default("no"),
  calendarConnected: text("calendar_connected").notNull().default("no"),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
});

export type ImportLog = typeof importLogsTable.$inferSelect;
