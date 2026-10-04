import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { propertiesTable } from "./properties";
import { ownerStatementsTable } from "./accounting";
import { paymentsTable } from "./payments";

/** Money paid to an owner against one owner statement: when, how and the bank reference. A statement can only be
 *  marked paid once its payout records add up to its balance. */
export const ownerPayoutsTable = pgTable("owner_payouts", {
  id: serial("id").primaryKey(),
  statementId: integer("statement_id").notNull().references(() => ownerStatementsTable.id),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  ownerId: integer("owner_id"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  /** Date the money left (YYYY-MM-DD, Dubai). */
  paidOn: text("paid_on").notNull(),
  /** bank_transfer | cash | cheque | other | not_recorded (statements marked paid before payout records existed). */
  method: text("method").notNull(),
  /** Bank transfer reference, cheque number or receipt number. */
  reference: text("reference"),
  notes: text("notes"),
  /** The matching row on the Payouts list. */
  paymentId: integer("payment_id").references(() => paymentsTable.id),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** One line from an Airbnb payout file (earnings export or reservation breakdowns), kept for the payout check.
 *  kind "booking" carries a confirmation code; kind "transfer" is a payout Airbnb sent (e.g. a USD PayPal transfer). */
export const airbnbPayoutLinesTable = pgTable("airbnb_payout_lines", {
  id: text("id").primaryKey(),
  /** "earnings" (what Airbnb paid or will pay) or "breakdown" (what the booking's breakdown says). */
  source: text("source").notNull(),
  kind: text("kind").notNull(),
  confirmationCode: text("confirmation_code"),
  listing: text("listing"),
  guestName: text("guest_name"),
  checkIn: text("check_in"),
  checkOut: text("check_out"),
  currency: text("currency").notNull(),
  /** What reached the account holder's payouts for this line (after any co-host cut); for a transfer, its amount. */
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  /** Co-host payout (positive), when the line has one. */
  cohostPayout: numeric("cohost_payout", { precision: 14, scale: 2 }),
  /** "paid" when the file shows Airbnb paying it, "expected" when only the booking breakdown gives it. */
  cohostBasis: text("cohost_basis"),
  cohostTo: text("cohost_to"),
  guestPaid: numeric("guest_paid", { precision: 14, scale: 2 }),
  payoutDate: text("payout_date"),
  /** paid | upcoming */
  status: text("status").notNull(),
  reference: text("reference"),
  destination: text("destination"),
  notes: text("notes"),
  fileName: text("file_name"),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
});
