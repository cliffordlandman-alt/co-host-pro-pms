import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { ownersTable } from "./properties";

export const ownerOtpTable = pgTable("owner_otp", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => ownersTable.id),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OwnerOtp = typeof ownerOtpTable.$inferSelect;
