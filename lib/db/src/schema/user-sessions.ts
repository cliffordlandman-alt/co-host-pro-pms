import { pgTable, serial, varchar, timestamp, integer } from "drizzle-orm/pg-core";

export const userSessionsTable = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userEmail: varchar("user_email", { length: 255 }),
  userName: varchar("user_name", { length: 255 }),
  userRole: varchar("user_role", { length: 50 }),
  startedAt: timestamp("started_at").defaultNow(),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  durationSeconds: integer("duration_seconds"),
  ipAddress: varchar("ip_address", { length: 100 }),
});
