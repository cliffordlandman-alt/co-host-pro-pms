import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { propertiesTable } from "./properties";

/** Outbound calendar (iCal export) per property. The token is the only secret in the public link
 *  /api/ical/<token>/<channel>.ics: 32 random bytes, rotatable, never written to the activity log. */
export const calendarExportsTable = pgTable("calendar_exports", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  token: text("token").notNull(),
  /** Off (default): only YallaPMS's own blocks and direct bookings. On: other channels' bookings too
   *  (never a channel's own bookings back to that channel, so nothing echoes). */
  includeChannelBookings: boolean("include_channel_bookings").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  rotatedAt: timestamp("rotated_at"),
  lastFetchedAt: timestamp("last_fetched_at"),
  fetchCount: integer("fetch_count").notNull().default(0),
}, t => [
  uniqueIndex("calendar_exports_property_unique").on(t.propertyId),
  uniqueIndex("calendar_exports_token_unique").on(t.token),
]);

/** Health of each incoming channel calendar (one row per property and channel), written by every sync. */
export const channelSyncHealthTable = pgTable("channel_sync_health", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  platform: text("platform").notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at"),
  /** First failure of the current run of failures; cleared by the next successful sync. */
  failingSince: timestamp("failing_since"),
  /** When the in-app "failing for more than 2 hours" alert was raised for the current run of failures. */
  alertedAt: timestamp("alerted_at"),
  lastSummary: text("last_summary"),
}, t => [uniqueIndex("channel_sync_health_property_platform_unique").on(t.propertyId, t.platform)]);

export type CalendarExport = typeof calendarExportsTable.$inferSelect;
export type ChannelSyncHealth = typeof channelSyncHealthTable.$inferSelect;
