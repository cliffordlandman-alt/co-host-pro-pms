import { Router } from "express";
import { db, ownersTable, propertiesTable, reservationsTable, maintenanceTicketsTable, paymentsTable, insertOwnerSchema, ownerStatementsTable, ownerOtpTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";

const router = Router();

router.get("/owners", async (req, res) => {
  const rows = await db.select().from(ownersTable).orderBy(ownersTable.name);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.get("/owners/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(ownersTable).where(eq(ownersTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.post("/owners", async (req, res) => {
  const parsed = insertOwnerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [row] = await db.insert(ownersTable).values(parsed.data).returning();
  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.patch("/owners/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = insertOwnerSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  if (!Object.keys(parsed.data).length) return res.status(400).json({ error: "Nothing to update" });
  if (parsed.data.email) parsed.data.email = parsed.data.email.trim().toLowerCase();
  const [row] = await db.update(ownersTable).set(parsed.data).where(eq(ownersTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.delete("/owners/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [[property], [statement], [payment]] = await Promise.all([
    db.select({ id: propertiesTable.id }).from(propertiesTable).where(eq(propertiesTable.ownerId, id)).limit(1),
    db.select({ id: ownerStatementsTable.id }).from(ownerStatementsTable).where(eq(ownerStatementsTable.ownerId, id)).limit(1),
    db.select({ id: paymentsTable.id }).from(paymentsTable).where(eq(paymentsTable.ownerId, id)).limit(1),
  ]);
  if (property) return res.status(409).json({ error: "Reassign or archive this owner's properties before deleting the owner." });
  if (statement || payment) return res.status(409).json({ error: "This owner has statements or payouts on record, so the owner cannot be deleted." });
  await db.delete(ownerOtpTable).where(eq(ownerOtpTable.ownerId, id));
  await db.delete(ownersTable).where(eq(ownersTable.id, id));
  res.status(204).send();
});

router.get("/owners/:ownerId/statement/:year/:month", async (req, res) => {
  const ownerId = parseInt(req.params.ownerId);
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);

  const [owner] = await db.select().from(ownersTable).where(eq(ownersTable.id, ownerId));
  if (!owner) return res.status(404).json({ error: "Not found" });

  const period=`${year}-${String(month).padStart(2,"0")}`;
  const rows=await db.select().from(ownerStatementsTable).where(and(eq(ownerStatementsTable.ownerId,ownerId),eq(ownerStatementsTable.month,period)));
  const props=await db.select().from(propertiesTable).where(eq(propertiesTable.ownerId,ownerId));
  const currencies=[...new Set(rows.map(r=>r.currency))];
  if(currencies.length>1) return res.status(400).json({error:"View separate property statements for different currencies"});
  const totalRevenue=rows.reduce((n,r)=>n+Number(r.grossRevenue),0), netPayout=rows.reduce((n,r)=>n+Number(r.ownerPayout),0);
  res.json({ownerId,ownerName:owner.name,month,year,totalRevenue,totalExpenses:totalRevenue-netPayout,netPayout,maintenanceCosts:rows.reduce((n,r)=>n+Number(r.maintenanceCosts),0),cleaningCosts:rows.reduce((n,r)=>n+Number(r.cleaningCosts),0),properties:rows.map(r=>({propertyId:r.propertyId,propertyName:props.find(p=>p.id===r.propertyId)?.name,revenue:Number(r.grossRevenue),expenses:Number(r.grossRevenue)-Number(r.ownerPayout)})),message:rows.length?null:"Generate this month's statements in Finance first"});
});

export default router;
