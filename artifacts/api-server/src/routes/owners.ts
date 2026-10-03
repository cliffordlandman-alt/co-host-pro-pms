import { Router } from "express";
import { db, ownersTable, propertiesTable, reservationsTable, maintenanceTicketsTable, paymentsTable, insertOwnerSchema, ownerStatementsTable, ownerOtpTable } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { insertAuditLog } from "../lib/audit";
import { SUGGESTED_OWNERS, phoneKey } from "../lib/suggested-owners";

const router = Router();

router.get("/owners", async (req, res) => {
  const rows = await db.select().from(ownersTable).orderBy(ownersTable.name);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

const DISMISSED_KEY = "ownerSuggestionsDismissed";
async function dismissedKeys(): Promise<string[]> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, DISMISSED_KEY));
  return Array.isArray(row?.value) ? (row!.value as string[]) : [];
}

// Suggested owners still to set up: hidden once dismissed, or once the owner exists and every matched property
// is assigned to them. Read-only.
router.get("/owners/suggestions", async (_req, res) => {
  const [owners, props, dismissed] = await Promise.all([db.select().from(ownersTable), db.select().from(propertiesTable), dismissedKeys()]);
  const active = props.filter(p => p.status === "active");
  const out = [];
  for (const s of SUGGESTED_OWNERS) {
    if (dismissed.includes(s.key)) continue;
    const existing = owners.find(o => o.name.trim().toLowerCase() === s.name.toLowerCase() || (phoneKey(o.phone) && phoneKey(o.phone) === phoneKey(s.phone))) ?? null;
    const properties = s.properties.map(want => {
      const hits = active.filter(p => p.name.toLowerCase().includes(want.label.toLowerCase()));
      if (hits.length !== 1) return { label: want.label, expectedCurrency: want.expectedCurrency, match: null, problem: hits.length ? `${hits.length} active properties match "${want.label}"; assign it on the property page` : `No active property matches "${want.label}"` };
      const p = hits[0]; const owner = owners.find(o => o.id === p.ownerId);
      const otherOwner = p.ownerId != null && p.ownerId !== existing?.id;
      return { label: want.label, expectedCurrency: want.expectedCurrency,
        match: { id: p.id, name: p.name, currency: p.currency, ownerId: p.ownerId, ownerName: owner?.name ?? null },
        problem: otherOwner ? `Already assigned to ${owner?.name ?? `owner #${p.ownerId}`}; not changed from here` : null };
    });
    const matched = properties.filter(p => p.match);
    if (existing && matched.every(p => p.match!.ownerId === existing.id)) continue;
    out.push({ key: s.key, name: s.name, phone: s.phone, note: s.note, cohostOption: s.cohostOption, feeOption: s.feeOption ?? null,
      existingOwner: existing ? { id: existing.id, name: existing.name, phone: existing.phone } : null, properties });
  }
  res.json(out);
});

router.post("/owners/suggestions/:key/dismiss", async (req, res) => {
  const key = String(req.params.key);
  if (!SUGGESTED_OWNERS.some(s => s.key === key)) return res.status(404).json({ error: "Not found" });
  const keys = [...new Set([...(await dismissedKeys()), key])];
  await db.insert(appSettingsTable).values({ key: DISMISSED_KEY, value: keys }).onConflictDoUpdate({ target: appSettingsTable.key, set: { value: keys, updatedAt: new Date() } });
  await insertAuditLog({ action: "update", entity: "owner_suggestion", entityId: 0, details: { dismissed: key }, performedBy: req.headers["x-user-id"] as string });
  res.json({ ok: true });
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
  // Creating an owner sends nothing (no login email or WhatsApp); the owner signs in later by requesting a code.
  await insertAuditLog({ action: "create", entity: "owner", entityId: row.id, details: parsed.data, performedBy: req.headers["x-user-id"] as string });
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
  await insertAuditLog({ action: "update", entity: "owner", entityId: id, details: parsed.data, performedBy: req.headers["x-user-id"] as string });
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
  const [gone] = await db.delete(ownersTable).where(eq(ownersTable.id, id)).returning();
  if (gone) await insertAuditLog({ action: "delete", entity: "owner", entityId: id, details: { name: gone.name }, performedBy: req.headers["x-user-id"] as string });
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
