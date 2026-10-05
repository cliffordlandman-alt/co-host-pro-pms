import { pgTable, text, integer, numeric, timestamp } from 'drizzle-orm/pg-core';
import { propertiesTable } from './properties';
export const airbnbEarningsTable = pgTable('airbnb_earnings', {
 id: text('id').primaryKey(), confirmationCode: text('confirmation_code').notNull(),
 propertyId: integer('property_id').notNull().references(()=>propertiesTable.id),
 guestName: text('guest_name').notNull(), checkIn: text('check_in').notNull(), checkOut: text('check_out').notNull(),
 kind: text('kind').notNull(), currency: text('currency').notNull(), amount: numeric('amount',{precision:14,scale:2}).notNull(),
 status: text('status').notNull(), payoutId: text('payout_id'), sourceDate: text('source_date').notNull(),
 importedAt: timestamp('imported_at').defaultNow().notNull(),
});
export const airbnbPayoutsTable = pgTable('airbnb_payouts', {
 id:text('id').primaryKey(), currency:text('currency').notNull(), amount:numeric('amount',{precision:14,scale:2}).notNull(),
 sourceDate:text('source_date').notNull(), importedAt:timestamp('imported_at').defaultNow().notNull(),
});
