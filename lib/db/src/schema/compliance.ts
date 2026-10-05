import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { propertiesTable } from "./properties";

/** Dubai compliance record per unit (DTCM holiday-home permit, building NOC, insurance, Ejari).
 *  Reference fields only: document uploads need file storage, which comes with hosting. */
export const propertyPermitsTable = pgTable("property_permits", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => propertiesTable.id),
  dtcmPermitNumber: text("dtcm_permit_number"),
  /** "standard" or "deluxe" (DTCM holiday-home classification); null = not recorded. */
  dtcmClass: text("dtcm_class"),
  permitIssueDate: text("permit_issue_date"),
  permitExpiryDate: text("permit_expiry_date"),
  /** Owners' association (building) no-objection certificate. */
  oaNocReference: text("oa_noc_reference"),
  oaNocExpiryDate: text("oa_noc_expiry_date"),
  insuranceReference: text("insurance_reference"),
  insuranceExpiryDate: text("insurance_expiry_date"),
  ejariNumber: text("ejari_number"),
  ejariExpiryDate: text("ejari_expiry_date"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by"),
}, t => [uniqueIndex("property_permits_property_unique").on(t.propertyId)]);

/** A filed return (e.g. the monthly DTCM Tourism Dirham return), recorded by hand once it is filed. */
export const complianceFilingsTable = pgTable("compliance_filings", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  /** Month the return covers (YYYY-MM). */
  period: text("period").notNull(),
  filedOn: text("filed_on").notNull(),
  reference: text("reference"),
  filedBy: text("filed_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => [uniqueIndex("compliance_filings_kind_period_unique").on(t.kind, t.period)]);

export type PropertyPermit = typeof propertyPermitsTable.$inferSelect;
export type ComplianceFiling = typeof complianceFilingsTable.$inferSelect;
