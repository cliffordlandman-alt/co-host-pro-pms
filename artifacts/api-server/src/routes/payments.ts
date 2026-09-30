import { Router } from "express";
import { dubaiToday } from "../lib/dubai-date";
import { db, paymentsTable, propertiesTable, ownersTable, insertPaymentSchema, reservationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/payments", async (req, res) => {
  const { type, propertyId } = req.query as { type?: string; propertyId?: string };
  const conditions = [];
  if (type) conditions.push(eq(paymentsTable.type, type));
  if (propertyId) conditions.push(eq(paymentsTable.propertyId, parseInt(propertyId)));

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
