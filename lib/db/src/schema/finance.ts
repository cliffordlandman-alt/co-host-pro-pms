import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { propertiesTable } from "./properties";

/**
 * YALLA monthly workbook inputs (migration 0025). Deposits are balance-sheet items, never P&L:
 * kind "asset" = money the company paid and gets back (e.g. the Sunrise Bay 2106 security deposit);
 * kind "liability" = money held for a guest or tenant (owed back). Status held → refunded (cash moves, balance
 * clears) or kept (kept_amount goes to income as a damage recovery; the rest, if any, was refunded).
 */
export const depositsTable = pgTable("deposits", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  /** Who paid it to us (liability) or who holds it for us (asset). */
  counterparty: text("counterparty").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("AED"),
  /** Date the money moved in (liability) or out (asset). YYYY-MM-DD. */
  date: text("date").notNull(),
  method: text("method"),
  status: text("status").notNull().default("held"),
  /** Date it was refunded or kept. */
  settledOn: text("settled_on"),
  keptAmount: numeric("kept_amount", { precision: 12, scale: 2 }),
  keptReason: text("kept_reason"),
  leaseId: integer("lease_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** A lease the company pays (e.g. Sunrise Bay 2106). P&L accruals are derived from the cheques (lib/lease-schedule.mjs). */
export const leaseSchedulesTable = pgTable("lease_schedules", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  name: text("name").notNull(),
  landlord: text("landlord"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  annualRent: numeric("annual_rent", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("AED"),
  agencyFee: numeric("agency_fee", { precision: 12, scale: 2 }),
  agencyFeeDate: text("agency_fee_date"),
  agencyFeeNote: text("agency_fee_note"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Cash schedule of a lease: one row per cheque. paid_on null = not paid yet. */
export const leaseChequesTable = pgTable("lease_cheques", {
  id: serial("id").primaryKey(),
  leaseId: integer("lease_id").notNull().references(() => leaseSchedulesTable.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  dueDate: text("due_date").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  /** Months of rent this cheque covers (3 for a quarterly cheque). */
  months: integer("months").notNull().default(3),
  paidOn: text("paid_on"),
  reference: text("reference"),
}, t => [uniqueIndex("lease_cheques_seq_unique").on(t.leaseId, t.seq)]);

/** Bank closing balance on the last day of a month, typed in (later from statements). */
export const bankBalancesTable = pgTable("bank_balances", {
  id: serial("id").primaryKey(),
  account: text("account").notNull().default("ADIB 19589605"),
  month: text("month").notNull(),
  balanceDate: text("balance_date").notNull(),
  balance: numeric("balance", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("AED"),
  source: text("source").notNull().default("manual"),
  notes: text("notes"),
  /** Migration 0027: month_end (one per account and month) or latest (one dated latest balance per account). */
  kind: text("kind").notNull().default("month_end"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => [
  uniqueIndex("bank_balances_month_end_unique").on(t.account, t.month).where(sql`${t.kind} = 'month_end'`),
  uniqueIndex("bank_balances_latest_unique").on(t.account).where(sql`${t.kind} = 'latest'`),
]);

export type Deposit = typeof depositsTable.$inferSelect;
export type LeaseSchedule = typeof leaseSchedulesTable.$inferSelect;
export type LeaseCheque = typeof leaseChequesTable.$inferSelect;
export type BankBalance = typeof bankBalancesTable.$inferSelect;
