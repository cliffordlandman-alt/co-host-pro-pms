import { pgTable, text, integer, serial, timestamp } from "drizzle-orm/pg-core";

export const yallareadyAnalysesTable = pgTable("yallaready_analyses", {
  analysisId: text("analysis_id").primaryKey(),
  sessionId: text("session_id").notNull(),
  roomType: text("room_type").notNull(),
  budget: integer("budget").notNull(),
  scoreBefore: integer("score_before").notNull(),
  scoreAfter: integer("score_after").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const yallareadyTrialUsersTable = pgTable("yallaready_trial_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  imageCount: integer("image_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type YallareadyAnalysis = typeof yallareadyAnalysesTable.$inferSelect;
export type InsertYallareadyAnalysis = typeof yallareadyAnalysesTable.$inferInsert;
export type YallareadyTrialUser = typeof yallareadyTrialUsersTable.$inferSelect;
export type InsertYallareadyTrialUser = typeof yallareadyTrialUsersTable.$inferInsert;
