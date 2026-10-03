import { companyStatement } from "../../../../lib/company-statement.mjs";
import { bookingCurrency, confirmationCode, sortStatementBookings } from "../../../../lib/booking-currency.mjs";
import { airbnbEarningsTable } from "@workspace/db";
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  insertAccountingTransactionSchema,
  propertySettingsTable,
  accountingTransactionsTable,
  ownerStatementsTable,
  propertiesTable,
  reservationsTable,
  maintenanceTicketsTable,
  paymentsTable,
} from "@workspace/db";
import { eq, and, gte, lte, ne, sql, inArray } from "drizzle-orm";
import { asyncHandler } from "./asyncHandler";
import { parseId } from "./parseId";

/** Statements that share a property and month (possible only in data created before migration 0012). */
export async function duplicateOwnerStatements() {
 const rows = await db.select({id:ownerStatementsTable.id,propertyId:ownerStatementsTable.propertyId,propertyName:propertiesTable.name,month:ownerStatementsTable.month,status:ownerStatementsTable.status,ownerPayout:ownerStatementsTable.ownerPayout,currency:ownerStatementsTable.currency,createdAt:ownerStatementsTable.createdAt})
  .from(ownerStatementsTable).leftJoin(propertiesTable,eq(ownerStatementsTable.propertyId,propertiesTable.id))
  .where(sql`(${ownerStatementsTable.propertyId}, ${ownerStatementsTable.month}) IN (SELECT property_id, month FROM owner_statements GROUP BY property_id, month HAVING count(*) > 1)`)
  .orderBy(ownerStatementsTable.propertyId, ownerStatementsTable.month, ownerStatementsTable.id);
 const groups = new Map<string, any>();
 for(const r of rows){const k=`${r.propertyId}|${r.month}`;if(!groups.has(k))groups.set(k,{propertyId:r.propertyId,propertyName:r.propertyName,month:r.month,statements:[]});groups.get(k).statements.push({id:r.id,status:r.status,ownerPayout:Number(r.ownerPayout),currency:r.currency,createdAt:r.createdAt.toISOString()});}
 return [...groups.values()];
}

export async function refreshOwnerStatements(month:string) {
 const startDate = `${month}-01`, endDate = `${month}-31`;
 const generated:any[] = [], skipped:any[] = [];
 await db.transaction(async tx=>{
  const props = await tx.select().from(propertiesTable).where(eq(propertiesTable.status,"active")).for("update");
  const settings = await tx.select().from(propertySettingsTable);
  for(const prop of props) {
   if(!prop.ownerId) {skipped.push({property:prop.name,propertyId:prop.id,reason:"Owner not assigned",noOwner:true});continue;}
   const found = await tx.select().from(ownerStatementsTable).where(and(eq(ownerStatementsTable.propertyId,prop.id),eq(ownerStatementsTable.month,month)));
   // Older data may hold two statements for one property/month; never pick one silently or add a third.
   if(found.length>1) {skipped.push({property:prop.name,reason:`Duplicate statements for ${month} (#${found.map(s=>s.id).join(", #")}); resolve them before this statement can be recalculated, sent or paid`,duplicate:true});continue;}
   const [existing] = found;
   if(existing && existing.status!=="draft") {skipped.push({property:prop.name,propertyId:prop.id,reason:"Published statement is locked",locked:true});continue;}
   // Recognize each entire stay in its checkout month; never duplicate a stay across statements.
   const bookings = (await tx.select().from(reservationsTable).where(and(eq(reservationsTable.propertyId,prop.id),ne(reservationsTable.status,"cancelled"),gte(reservationsTable.checkOut,startDate),lte(reservationsTable.checkOut,endDate)))).filter(r=>r.status!=="blocked");
   const unverified = bookings.filter(r=>r.financeMode!=="inclusive-v1");
   const rules = settings.find(s=>s.propertyId===prop.id);
   // The owner is the Airbnb co-host and Airbnb pays the co-host payout to them directly: every Airbnb booking
   // needs that amount (reservations.cohost_payout, from the breakdown import) before a balance can be worked out.
   const cohostDirect = rules?.cohostPaidToOwner === true;
   const cohostMissing = cohostDirect ? bookings.filter(r=>r.platform==="airbnb"&&r.cohostPayout==null) : [];
   // Fee basis "net-payout": every booking must have been calculated on it (actual channel fees, management % of
   // the net payout). A booking calculated on another basis, or without the channel's actual fees, blocks the
   // statement; there is no fallback to a percentage.
   const netBasis = rules?.feeBasis === "net-payout";
   const wrongBasis = bookings.filter(r=>r.financeMode==="inclusive-v1"&&(r.feeBasis==="net-payout")!==netBasis);
   const alsoCohost = cohostMissing.filter(r=>r.financeMode==="inclusive-v1");
   const brief = (r:any)=>({id:r.id,guestName:r.guestName,checkIn:r.checkIn,checkOut:r.checkOut,platform:r.platform});
   const s = (n:number)=>n===1?"":"s";
   if(unverified.length||alsoCohost.length||wrongBasis.length) {
    const parts:string[] = [];
    if(unverified.length) parts.push(`${unverified.length} booking${s(unverified.length)} checked out this month need the guest total verified before a payout can be calculated`);
    if(alsoCohost.length) parts.push(unverified.length?`${alsoCohost.length} more need the co-host payout`:`Co-host payout missing on ${alsoCohost.length} Airbnb booking${s(alsoCohost.length)}: Airbnb pays it to the owner directly, so it's needed to work out the balance`);
    if(wrongBasis.length) parts.push(netBasis?`${wrongBasis.length} booking${s(wrongBasis.length)} not yet calculated on this property's fee basis (management % of the channel net payout): enter the channel's actual fees on Verify`:`${wrongBasis.length} booking${s(wrongBasis.length)} calculated on the net-payout fee basis, but the property now uses the standard basis: save them on Verify to recalculate`);
    const reason = parts.join("; ")+(unverified.length&&cohostMissing.length?" (Airbnb pays the co-host payout to the owner directly, so each Airbnb booking needs it)":"");
    skipped.push({property:prop.name,propertyId:prop.id,reason,unverified:unverified.map(brief),cohostMissing:alsoCohost.map(brief),cohostRequired:cohostDirect,
     ...(wrongBasis.length?{feeBasis:netBasis?"net-payout":"gross",feeBasisMismatch:wrongBasis.map(r=>({...brief(r),feesMissing:r.channelFees==null}))}:{})});
    continue;
   }
   const cents = (n:any)=>Math.round(Number(n || 0)*100);
   const sum = (key:string)=>bookings.reduce((n,r)=>n+cents((r as any)[key]),0);
   const expenses = await tx.select().from(accountingTransactionsTable).where(and(eq(accountingTransactionsTable.propertyId,prop.id),eq(accountingTransactionsTable.type,"expense"),eq(accountingTransactionsTable.allocation,"owner"),gte(accountingTransactionsTable.date,startDate),lte(accountingTransactionsTable.date,endDate)));
   const tickets = await tx.select().from(maintenanceTicketsTable).where(and(eq(maintenanceTicketsTable.propertyId,prop.id),eq(maintenanceTicketsTable.status,"completed"),gte(maintenanceTicketsTable.completedAt,startDate),lte(maintenanceTicketsTable.completedAt,`${endDate}T23:59:59.999Z`)));
   const maintenance = rules?.includeMaintenance===false ? 0 : tickets.filter(t=>t.chargeType==="owner" && !expenses.some(e=>e.reference===`maintenance:${t.id}`)).reduce((n,t)=>n+cents(t.cost),0);
   // One currency per statement. Each booking is in its own currency (stamped when the property's currency
   // changed, else the property's); entries carry theirs. Amounts in different currencies are never added
   // together and there is no exchange rate in the app, so a month that mixes them is not generated.
   const propertyCurrency = prop.currency || rules?.currency || "AED";
   const byCurrency = new Map<string,{bookings:any[];entries:number}>();
   for(const r of bookings){const c=bookingCurrency(r,{currency:propertyCurrency});const g=byCurrency.get(c)??{bookings:[],entries:0};g.bookings.push(brief(r));byCurrency.set(c,g);}
   for(const e of expenses){const c=e.currency||propertyCurrency;const g=byCurrency.get(c)??{bookings:[],entries:0};g.entries++;byCurrency.set(c,g);}
   // Maintenance tickets have no currency of their own: they are in the property's currency.
   if(maintenance){const g=byCurrency.get(propertyCurrency)??{bookings:[],entries:0};g.entries++;byCurrency.set(propertyCurrency,g);}
   if(byCurrency.size>1) {
    const list=[...byCurrency.entries()].map(([currency,g])=>({currency,bookings:sortStatementBookings(g.bookings),entries:g.entries}));
    const describe=list.map(g=>[g.bookings.length?`${g.bookings.length} booking${s(g.bookings.length)}`:"",g.entries?`${g.entries} expense${s(g.entries)}`:""].filter(Boolean).join(" and ")+` in ${g.currency}`).join(", ");
    skipped.push({property:prop.name,propertyId:prop.id,reason:`Mixed currency: ${describe}. Adding them needs an exchange rate, which the app doesn't have or invent, so this statement isn't generated.`,mixedCurrency:list});
    continue;
   }
   const statementCurrency = byCurrency.size===1 ? [...byCurrency.keys()][0] : propertyCurrency;
   const cleaning = rules?.includeCleaning===false ? 0 : sum("cleaningFee");
   const other = expenses.reduce((n,e)=>n+cents(e.amount),0);
   const gross=sum("grossAmount"), vat=sum("vatAmount"), tourism=sum("tourismFee"), management=sum("managementAmount"), channel=sum("channelAmount");
   const paidByAirbnb = cohostDirect ? sum("cohostPayout") : 0;
   const money=(n:number)=>(n/100).toFixed(2);
   const data={ownerId:prop.ownerId,propertyId:prop.id,month,currency:statementCurrency,grossRevenue:money(gross),vatAmount:money(vat),tourismFee:money(tourism),platformFees:money(channel),managementFee:money(management),cleaningCosts:money(cleaning),maintenanceCosts:money(maintenance),otherExpenses:money(other),ownerPayout:money(gross-vat-tourism-channel-management-cleaning-maintenance-other-paidByAirbnb),paidByAirbnb:money(paidByAirbnb),feeBasis:netBasis?"net-payout":null,bookingsCount:bookings.length,nightsOccupied:bookings.reduce((n,r)=>n+r.nights,0),bookingDetails:JSON.stringify(sortStatementBookings(bookings.map(r=>({id:r.id,code:confirmationCode(r.externalId),guestName:r.guestName,checkIn:r.checkIn,checkOut:r.checkOut,platform:r.platform,grossAmount:r.grossAmount,revenue:r.revenue,vatAmount:r.vatAmount,tourismFee:r.tourismFee,managementAmount:r.managementAmount,channelAmount:r.channelAmount,cleaningFee:r.cleaningFee,ownerAmount:r.ownerAmount,cohostPayout:r.cohostPayout,...(netBasis?{channelFees:r.channelFees,managementPercent:r.managementPercent,feeBasis:r.feeBasis}:{})})))),notes:"Revenue recognized in checkout month. VAT and tourism are extracted from guest total. Cleaning deductions use the booking's agreed fee; do not also enter the same charge as an expense."+(netBasis?" Management fee is a percentage of the channel net payout (guest total minus the channel's actual fees); platform fees are the channel's actual fees.":"")+(cohostDirect?" Airbnb pays the co-host payout to the owner directly; it is shown as already paid and deducted from the balance.":""),status:"draft"};
   let [row] = existing ? await tx.update(ownerStatementsTable).set(data).where(eq(ownerStatementsTable.id,existing.id)).returning() : await tx.insert(ownerStatementsTable).values(data).onConflictDoNothing().returning();
   if(!row) {
    // Another request created this property/month statement first (unique index): update it if still a draft.
    const [other] = await tx.select().from(ownerStatementsTable).where(and(eq(ownerStatementsTable.propertyId,prop.id),eq(ownerStatementsTable.month,month)));
    if(!other || other.status!=="draft") {skipped.push({property:prop.name,reason:"Published statement is locked"});continue;}
    [row] = await tx.update(ownerStatementsTable).set(data).where(eq(ownerStatementsTable.id,other.id)).returning();
   }
   generated.push(row);
  }
 });
 return {generated:generated.length,statements:generated,skipped};
}
