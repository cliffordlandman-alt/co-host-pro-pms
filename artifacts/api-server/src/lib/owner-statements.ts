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

export async function refreshOwnerStatements(month:string) {
 const startDate = `${month}-01`, endDate = `${month}-31`;
 const generated:any[] = [], skipped:any[] = [];
 await db.transaction(async tx=>{
  const props = await tx.select().from(propertiesTable).where(eq(propertiesTable.status,"active")).for("update");
  const settings = await tx.select().from(propertySettingsTable);
  for(const prop of props) {
   if(!prop.ownerId) {skipped.push({property:prop.name,reason:"Owner not assigned"});continue;}
   const [existing] = await tx.select().from(ownerStatementsTable).where(and(eq(ownerStatementsTable.propertyId,prop.id),eq(ownerStatementsTable.month,month)));
   if(existing && existing.status!=="draft") {skipped.push({property:prop.name,reason:"Published statement is locked"});continue;}
   // Recognize each entire stay in its checkout month; never duplicate a stay across statements.
   const bookings = (await tx.select().from(reservationsTable).where(and(eq(reservationsTable.propertyId,prop.id),ne(reservationsTable.status,"cancelled"),gte(reservationsTable.checkOut,startDate),lte(reservationsTable.checkOut,endDate)))).filter(r=>r.status!=="blocked");
   if(bookings.some(r=>r.financeMode!=="inclusive-v1")) {skipped.push({property:prop.name,reason:"Booking totals and fee breakdowns must be verified before a payout can be calculated"});continue;}
   const rules = settings.find(s=>s.propertyId===prop.id);
   const cents = (n:any)=>Math.round(Number(n || 0)*100);
   const sum = (key:string)=>bookings.reduce((n,r)=>n+cents((r as any)[key]),0);
   const expenses = await tx.select().from(accountingTransactionsTable).where(and(eq(accountingTransactionsTable.propertyId,prop.id),eq(accountingTransactionsTable.type,"expense"),eq(accountingTransactionsTable.allocation,"owner"),gte(accountingTransactionsTable.date,startDate),lte(accountingTransactionsTable.date,endDate)));
   const tickets = await tx.select().from(maintenanceTicketsTable).where(and(eq(maintenanceTicketsTable.propertyId,prop.id),eq(maintenanceTicketsTable.status,"completed"),gte(maintenanceTicketsTable.completedAt,startDate),lte(maintenanceTicketsTable.completedAt,`${endDate}T23:59:59.999Z`)));
   const maintenance = rules?.includeMaintenance===false ? 0 : tickets.filter(t=>t.chargeType==="owner" && !expenses.some(e=>e.reference===`maintenance:${t.id}`)).reduce((n,t)=>n+cents(t.cost),0);
   const cleaning = rules?.includeCleaning===false ? 0 : sum("cleaningFee");
   const other = expenses.reduce((n,e)=>n+cents(e.amount),0);
   const gross=sum("grossAmount"), vat=sum("vatAmount"), tourism=sum("tourismFee"), management=sum("managementAmount"), channel=sum("channelAmount");
   const money=(n:number)=>(n/100).toFixed(2);
   const data={ownerId:prop.ownerId,propertyId:prop.id,month,currency:prop.currency || rules?.currency || "AED",grossRevenue:money(gross),vatAmount:money(vat),tourismFee:money(tourism),platformFees:money(channel),managementFee:money(management),cleaningCosts:money(cleaning),maintenanceCosts:money(maintenance),otherExpenses:money(other),ownerPayout:money(gross-vat-tourism-channel-management-cleaning-maintenance-other),bookingsCount:bookings.length,nightsOccupied:bookings.reduce((n,r)=>n+r.nights,0),bookingDetails:JSON.stringify(bookings.map(r=>({id:r.id,guestName:r.guestName,checkIn:r.checkIn,checkOut:r.checkOut,platform:r.platform,grossAmount:r.grossAmount,revenue:r.revenue,vatAmount:r.vatAmount,tourismFee:r.tourismFee,managementAmount:r.managementAmount,channelAmount:r.channelAmount,cleaningFee:r.cleaningFee,ownerAmount:r.ownerAmount}))),notes:"Revenue recognized in checkout month. VAT and tourism are extracted from guest total. Cleaning deductions use the booking's agreed fee; do not also enter the same charge as an expense.",status:"draft"};
   const [row] = existing ? await tx.update(ownerStatementsTable).set(data).where(eq(ownerStatementsTable.id,existing.id)).returning() : await tx.insert(ownerStatementsTable).values(data).returning();
   generated.push(row);
  }
 });
 return {generated:generated.length,statements:generated,skipped};
}
