import { pgTable, serial, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { propertiesTable } from "./properties";
import { reservationsTable } from "./reservations";
import { cleaningTasksTable } from "./cleaning";

export const propertySettingsTable = pgTable("property_settings", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().unique().references(() => propertiesTable.id),
  tourismRate: numeric("tourism_rate", {precision:10,scale:2}).notNull().default("10"),
  tourismEnabled: boolean("tourism_enabled").notNull().default(true),
  vatEnabled: boolean("vat_enabled").notNull().default(true),
  managementFeePercent: numeric("management_fee_percent", { precision: 5, scale: 2 }).notNull().default("20"),
  platformFeeAirbnb: numeric("platform_fee_airbnb", { precision: 5, scale: 2 }).notNull().default("3"),
  platformFeeBookingCom: numeric("platform_fee_booking_com", { precision: 5, scale: 2 }).notNull().default("15"),
  platformFeeDirect: numeric("platform_fee_direct", { precision: 5, scale: 2 }).notNull().default("0"),
  platformFeeVrbo: numeric("platform_fee_vrbo", { precision: 5, scale: 2 }).notNull().default("0"),
  /** Not used (owner share is derived from managementFeePercent). */
  ownerSplitPercent: numeric("owner_split_percent", { precision: 5, scale: 2 }).notNull().default("80"),
  vatPercent: numeric("vat_percent", { precision: 5, scale: 2 }).notNull().default("5"),
  includeCleaning: boolean("include_cleaning").notNull().default(true),
  includeMaintenance: boolean("include_maintenance").notNull().default(true),
  // Airbnb pays the co-host payout straight to the owner (owner is the co-host); statements deduct it.
  cohostPaidToOwner: boolean("cohost_paid_to_owner").notNull().default(false),
  // "gross" (standard) or "net-payout": management % of the channel net payout, channel line = actual fees.
  feeBasis: text("fee_basis").notNull().default("gross"),
  currency: text("currency").notNull().default("AED"),
  /** Cleaning fee charged per booking (deducted from the owner; company income). Single source of truth;
   *  each booking snapshots it into reservations.cleaning_fee when calculated. */
  cleaningFee: numeric("cleaning_fee", { precision: 10, scale: 2 }),
  /** Optional per-property cleaning cost (what the cleaning company charges); overrides the rate card. */
  cleaningCostOverride: numeric("cleaning_cost_override", { precision: 10, scale: 2 }),
  /** Cleaned by the rate-card cleaning company. False + no override = "no rate set": cleans are skipped and flagged. */
  cleaningRateCard: boolean("cleaning_rate_card").notNull().default(false),
  /** Currency of cleaningCostOverride; null = the property's currency. */
  cleaningCostCurrency: text("cleaning_cost_currency"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const accountingTransactionsTable = pgTable("accounting_transactions", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  propertyId: integer("property_id").references(() => propertiesTable.id),
  reservationId: integer("reservation_id").references(() => reservationsTable.id),
  type: text("type").notNull().default("expense"),
  category: text("category").notNull().default("other"),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("AED"),
  allocation: text("allocation").notNull().default("owner"),
  /** Expense tag "revenue stream" yes/no (null = not tagged). Only on expenses. */
  revenueStream: boolean("revenue_stream"),
  reference: text("reference"),
  notes: text("notes"),
  vendorId: integer("vendor_id").references(() => vendorsTable.id),
  /** Set on the automatic cleaning expense; unique, so a task can never be expensed twice. */
  cleaningTaskId: integer("cleaning_task_id").unique("accounting_transactions_cleaning_task_uq").references(() => cleaningTasksTable.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ownerStatementsTable = pgTable("owner_statements", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull(),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  month: text("month").notNull(),
  tourismFee: numeric("tourism_fee", {precision:10,scale:2}).notNull().default("0"),
  bookingDetails: text("booking_details"),
  currency: text("currency").notNull().default("AED"),
  grossRevenue: numeric("gross_revenue", { precision: 10, scale: 2 }).notNull().default("0"),
  platformFees: numeric("platform_fees", { precision: 10, scale: 2 }).notNull().default("0"),
  managementFee: numeric("management_fee", { precision: 10, scale: 2 }).notNull().default("0"),
  cleaningCosts: numeric("cleaning_costs", { precision: 10, scale: 2 }).notNull().default("0"),
  maintenanceCosts: numeric("maintenance_costs", { precision: 10, scale: 2 }).notNull().default("0"),
  otherExpenses: numeric("other_expenses", { precision: 10, scale: 2 }).notNull().default("0"),
  vatAmount: numeric("vat_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  ownerPayout: numeric("owner_payout", { precision: 10, scale: 2 }).notNull().default("0"),
  // Co-host payouts Airbnb paid the owner directly (already deducted from ownerPayout, the balance due).
  paidByAirbnb: numeric("paid_by_airbnb", { precision: 10, scale: 2 }).notNull().default("0"),
  /** "net-payout" when generated on that fee basis; null = standard. */
  feeBasis: text("fee_basis"),
  nightsOccupied: integer("nights_occupied").notNull().default(0),
  bookingsCount: integer("bookings_count").notNull().default(0),
  status: text("status").notNull().default("draft"),
  sentAt: text("sent_at"),
  paidAt: text("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPropertySettingsSchema = createInsertSchema(propertySettingsTable).omit({ id: true, updatedAt: true });
export const insertAccountingTransactionSchema = createInsertSchema(accountingTransactionsTable).omit({ id: true, createdAt: true, cleaningTaskId: true });
export const insertOwnerStatementSchema = createInsertSchema(ownerStatementsTable).omit({ id: true, createdAt: true });

export type PropertySettings = typeof propertySettingsTable.$inferSelect;
export type AccountingTransaction = typeof accountingTransactionsTable.$inferSelect;
export type OwnerStatement = typeof ownerStatementsTable.$inferSelect;

export const vendorsTable = pgTable("vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("cleaning"),
  email: text("email"),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type Vendor = typeof vendorsTable.$inferSelect;

/** Cleaning company rate card: cost per checkout clean by bedroom count (0 = studio). */
export const cleaningCostRatesTable = pgTable("cleaning_cost_rates", {
  id: serial("id").primaryKey(),
  bedrooms: integer("bedrooms").notNull().unique(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("AED"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CleaningCostRate = typeof cleaningCostRatesTable.$inferSelect;
