import { companyStatement } from "../../../../lib/company-statement.mjs";
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
   if(unverified.length) {const alsoCohost=cohostMissing.filter(r=>r.financeMode==="inclusive-v1");skipped.push({property:prop.name,propertyId:prop.id,reason:`${unverified.length} booking${unverified.length===1?"":"s"} checked out this month need the guest total verified before a payout can be calculated${alsoCohost.length?`; ${alsoCohost.length} more need the co-host payout`:""}${cohostMissing.length?" (Airbnb pays the co-host payout to the owner directly, so each Airbnb booking needs it)":""}`,unverified:unverified.map(r=>({id:r.id,guestName:r.guestName,checkIn:r.checkIn,checkOut:r.checkOut,platform:r.platform})),cohostMissing:alsoCohost.map(r=>({id:r.id,guestName:r.guestName,checkIn:r.checkIn,checkOut:r.checkOut,platform:r.platform})),cohostRequired:cohostDirect});continue;}
   if(cohostMissing.length) {skipped.push({property:prop.name,propertyId:prop.id,cohostRequired:true,reason:`Co-host payout missing on ${cohostMissing.length} Airbnb booking${cohostMissing.length===1?"":"s"}: Airbnb pays it to the owner directly, so it's needed to work out the balance`,cohostMissing:cohostMissing.map(r=>({id:r.id,guestName:r.guestName,checkIn:r.checkIn,checkOut:r.checkOut,platform:r.platform}))});continue;}
   const cents = (n:any)=>Math.round(Number(n || 0)*100);
   const sum = (key:string)=>bookings.reduce((n,r)=>n+cents((r as any)[key]),0);
   const expenses = await tx.select().from(accountingTransactionsTable).where(and(eq(accountingTransactionsTable.propertyId,prop.id),eq(accountingTransactionsTable.type,"expense"),eq(accountingTransactionsTable.allocation,"owner"),gte(accountingTransactionsTable.date,startDate),lte(accountingTransactionsTable.date,endDate)));
   const tickets = await tx.select().from(maintenanceTicketsTable).where(and(eq(maintenanceTicketsTable.propertyId,prop.id),eq(maintenanceTicketsTable.status,"completed"),gte(maintenanceTicketsTable.completedAt,startDate),lte(maintenanceTicketsTable.completedAt,`${endDate}T23:59:59.999Z`)));
   const maintenance = rules?.includeMaintenance===false ? 0 : tickets.filter(t=>t.chargeType==="owner" && !expenses.some(e=>e.reference===`maintenance:${t.id}`)).reduce((n,t)=>n+cents(t.cost),0);
   const cleaning = rules?.includeCleaning===false ? 0 : sum("cleaningFee");
   const other = expenses.reduce((n,e)=>n+cents(e.amount),0);
   const gross=sum("grossAmount"), vat=sum("vatAmount"), tourism=sum("tourismFee"), management=sum("managementAmount"), channel=sum("channelAmount");
   const paidByAirbnb = cohostDirect ? sum("cohostPayout") : 0;
   const money=(n:number)=>(n/100).toFixed(2);
   const data={ownerId:prop.ownerId,propertyId:prop.id,month,currency:prop.currency || rules?.currency || "AED",grossRevenue:money(gross),vatAmount:money(vat),tourismFee:money(tourism),platformFees:money(channel),managementFee:money(management),cleaningCosts:money(cleaning),maintenanceCosts:money(maintenance),otherExpenses:money(other),ownerPayout:money(gross-vat-tourism-channel-management-cleaning-maintenance-other-paidByAirbnb),paidByAirbnb:money(paidByAirbnb),bookingsCount:bookings.length,nightsOccupied:bookings.reduce((n,r)=>n+r.nights,0),bookingDetails:JSON.stringify(bookings.map(r=>({id:r.id,guestName:r.guestName,checkIn:r.checkIn,checkOut:r.checkOut,platform:r.platform,grossAmount:r.grossAmount,revenue:r.revenue,vatAmount:r.vatAmount,tourismFee:r.tourismFee,managementAmount:r.managementAmount,channelAmount:r.channelAmount,cleaningFee:r.cleaningFee,ownerAmount:r.ownerAmount,cohostPayout:r.cohostPayout}))),notes:"Revenue recognized in checkout month. VAT and tourism are extracted from guest total. Cleaning deductions use the booking's agreed fee; do not also enter the same charge as an expense."+(cohostDirect?" Airbnb pays the co-host payout to the owner directly; it is shown as already paid and deducted from the balance.":""),status:"draft"};
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
