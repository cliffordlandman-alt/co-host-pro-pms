import { pgTable, serial, text, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const aiRequestsTable = pgTable("ai_requests", {
  id: serial("id").primaryKey(),
  tool: varchar("tool", { length: 80 }).notNull(),
  prompt: text("prompt"),
  result: text("result"),
  model: varchar("model", { length: 50 }).default("gpt-4o-mini"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  propertyId: integer("property_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AiRequest = typeof aiRequestsTable.$inferSelect;
export type InsertAiRequest = typeof aiRequestsTable.$inferInsert;
