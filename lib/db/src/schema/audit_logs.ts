import { pgTable, serial, varchar, timestamp, integer, text } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 50 }).notNull(), // create, update, delete
  entity: varchar("entity", { length: 50 }).notNull(), // property, reservation, etc.
  entityId: integer("entity_id").notNull(),
  details: text("details"), // JSON string
  performedBy: varchar("performed_by", { length: 255 }).notNull().default("system"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
