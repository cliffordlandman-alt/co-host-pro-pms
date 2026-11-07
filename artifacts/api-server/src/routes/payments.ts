import { Router } from "express";
import { toAed } from "../../../../lib/fx.mjs";
import { getFxBook } from "../lib/fx";
import { dubaiToday } from "../lib/dubai-date";
import { db, paymentsTable, propertiesTable, ownersTable, insertPaymentSchema, reservationsTable } from "@workspace/db";
import { eq, and, or, ilike, sql, desc } from "drizzle-orm";
import { pageParams, paged, likeTerm } from "../lib/paging";

const router = Router();

router.get("/payments", async (req, res) => {
  const { type, propertyId, status, q } = req.query as { type?: string; propertyId?: string; status?: string; q?: string };
  const conditions = [];
  if (type) conditions.push(eq(paymentsTable.type, type));
  if (propertyId) conditions.push(eq(paymentsTable.propertyId, parseInt(propertyId)));
  const p = pageParams(req.query as Record<string, unknown>);
  if (p) {
    if (status) conditions.push(eq(paymentsTable.status, status));
    if (q?.trim()) { const t = likeTerm(q.trim()); conditions.push(or(ilike(paymentsTable.description, t), ilike(propertiesTable.name, t), ilike(ownersTable.name, t))!); }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    // A payment for a booking is in the booking's currency. The total shown is the sum in dirhams.
    const currency = sql<string>`coalesce(${reservationsTable.currency}, ${propertiesTable.currency}, 'AED')`;
    const groups = await db.select({ currency, status: paymentsTable.status, count: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)::text` })
      .from(paymentsTable).leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id)).leftJoin(ownersTable, eq(paymentsTable.ownerId, ownersTable.id)).leftJoin(reservationsTable, eq(paymentsTable.reservationId, reservationsTable.id))
      .where(where).groupBy(currency, paymentsTable.status);
    const total = groups.reduce((n, g) => n + g.count, 0);
    const book = await getFxBook();
    const aed = { currency: "AED", count: 0, byStatus: {} as Record<string, number> };
    for (const g of groups) {
      aed.count += g.count;
      aed.byStatus[g.status] = Math.round(((aed.byStatus[g.status] || 0) + (toAed(g.amount, g.currency, null, book) || 0)) * 100) / 100;
    }
    const rows = await db.select({ id: paymentsTable.id, type: paymentsTable.type, propertyId: paymentsTable.propertyId, propertyName: propertiesTable.name, currency, reservationId: paymentsTable.reservationId, ownerId: paymentsTable.ownerId, ownerName: ownersTable.name, amount: paymentsTable.amount, status: paymentsTable.status, description: paymentsTable.description, dueDate: paymentsTable.dueDate, paidAt: paymentsTable.paidAt, createdAt: paymentsTable.createdAt })
      .from(paymentsTable).leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id)).leftJoin(ownersTable, eq(paymentsTable.ownerId, ownersTable.id)).leftJoin(reservationsTable, eq(paymentsTable.reservationId, reservationsTable.id))
      .where(where).orderBy(desc(paymentsTable.createdAt), desc(paymentsTable.id)).limit(p.pageSize).offset(p.offset);
    return res.json(paged(rows.map(r => ({ ...r, amount: parseFloat(r.amount || "0"), createdAt: r.createdAt.toISOString() })), total, p, { total, currencies: [aed] }));
  }

  const rows = await db
    .select({
      id: paymentsTable.id,
      type: paymentsTable.type,
      propertyId: paymentsTable.propertyId,
      propertyName: propertiesTable.name,
      reservationId: paymentsTable.reservationId,
      ownerId: paymentsTable.ownerId,
      ownerName: ownersTable.name,
      amount: paymentsTable.amount,
      status: paymentsTable.status,
      description: paymentsTable.description,
      dueDate: paymentsTable.dueDate,
      paidAt: paymentsTable.paidAt,
      createdAt: paymentsTable.createdAt,
    })
    .from(paymentsTable)
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .leftJoin(ownersTable, eq(paymentsTable.ownerId, ownersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(paymentsTable.createdAt);

  res.json(rows.map(r => ({
    ...r,
    amount: parseFloat(r.amount || "0"),
    createdAt: r.createdAt.toISOString(),
  })));
});

router.post("/payments", async (req,res)=>{
 const body={...req.body,amount:String(req.body.amount)};
 if(!/^\d+(\.\d{1,2})?$/.test(body.amount) || Number(body.amount)<=0) return res.status(400).json({error:"Payment must be greater than zero"});
 if(body.type==="owner_payout") return res.status(400).json({error:"Record owner payouts by marking the owner statement paid"});
 const parsed=insertPaymentSchema.safeParse(body);
 if(!parsed.success) return res.status(400).json({error:parsed.error.message});
 try {
  const row=await db.transaction(async tx=>{
   if(body.reservationId && body.type==="guest_payment") {
    const [booking]=await tx.select().from(reservationsTable).where(eq(reservationsTable.id,body.reservationId)).for("update");
    if(!booking || booking.status==="cancelled") throw new Error("Choose an active reservation");
    if(booking.financeMode!=="inclusive-v1") throw new Error("Verify the full booking total before recording a payment");
    if(body.status!=="paid") throw new Error("Record only received guest payments here");
    const balance=Math.round(Number(booking.balanceDue || 0)*100)-Math.round(Number(body.amount)*100);
    if(balance<0) throw new Error("Payment exceeds the outstanding balance");
    parsed.data.propertyId=booking.propertyId;
    await tx.update(reservationsTable).set({balanceDue:(balance/100).toFixed(2),paymentStatus:balance===0?"paid":"partial"}).where(eq(reservationsTable.id,booking.id));
   } else if(body.type==="guest_payment") throw new Error("Choose a reservation for the payment");
   const [row]=await tx.insert(paymentsTable).values({...parsed.data,paidAt:body.status==="paid"?dubaiToday():null}).returning();return row;
  });
  res.status(201).json({...row,amount:Number(row.amount)});
 } catch(e) {res.status(400).json({error:(e as Error).message});}
});

router.patch("/payments/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing]=await db.select().from(paymentsTable).where(eq(paymentsTable.id,id));
  if(existing?.status==="paid") return res.status(409).json({error:"Posted payments are immutable; record an adjustment instead"});
  const parsed=insertPaymentSchema.partial().safeParse({...req.body,...(req.body.amount!=null?{amount:String(req.body.amount)}:{})});
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  const [row] = await db.update(paymentsTable).set(parsed.data).where(eq(paymentsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ ...row, amount: parseFloat(row.amount || "0"), createdAt: row.createdAt.toISOString() });
});

router.delete("/payments/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing]=await db.select().from(paymentsTable).where(eq(paymentsTable.id,id));
  if(existing?.status==="paid") return res.status(409).json({error:"Posted payments cannot be deleted"});
  await db.delete(paymentsTable).where(eq(paymentsTable.id, id));
  res.status(204).send();
});

export default router;
