import { Router } from "express";
import { db, maintenanceTicketsTable, propertiesTable, staffTable, ownersTable, insertMaintenanceTicketSchema } from "@workspace/db";
import { eq, and, or, sql, desc } from "drizzle-orm";
import { pageParams, paged } from "../lib/paging";
import { notifyManagers, notifyStaffMember } from "../lib/whatsapp";
import { insertAuditLog } from "../lib/audit";
import { asyncHandler } from "../lib/asyncHandler";
import { parseId } from "../lib/parseId";

const router = Router();

// ─── Shared column selection ──────────────────────────────────────────────────

const maintenanceSelect = {
  id: maintenanceTicketsTable.id,
  propertyId: maintenanceTicketsTable.propertyId,
  propertyName: propertiesTable.name,
  unitNumber: propertiesTable.unitNumber,
  ownerName: ownersTable.name,
  issue: maintenanceTicketsTable.issue,
  priority: maintenanceTicketsTable.priority,
  assignedToId: maintenanceTicketsTable.assignedToId,
  assignedToName: staffTable.name,
  assignedToPhone: staffTable.phone,
  cost: maintenanceTicketsTable.cost,
  chargeType: maintenanceTicketsTable.chargeType,
  status: maintenanceTicketsTable.status,
  notes: maintenanceTicketsTable.notes,
  photos: maintenanceTicketsTable.photos,
  quoteAmount: maintenanceTicketsTable.quoteAmount,
  quotedBy: maintenanceTicketsTable.quotedBy,
  ownerApproval: maintenanceTicketsTable.ownerApproval,
  completedAt: maintenanceTicketsTable.completedAt,
  createdAt: maintenanceTicketsTable.createdAt,
} as const;

function formatTicket(r: {
  cost: string | null;
  quoteAmount: string | null;
  photos: string | null;
  createdAt: Date;
  completedAt: Date | string | null | undefined;
}) {
  return {
    ...r,
    cost: r.cost != null ? parseFloat(r.cost) : null,
    quoteAmount: r.quoteAmount != null ? parseFloat(r.quoteAmount) : null,
    photos: r.photos ? JSON.parse(r.photos) : [],
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt
      ? (r.completedAt instanceof Date ? r.completedAt.toISOString() : r.completedAt)
      : null,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/maintenance", asyncHandler(async (req, res) => {
  const { status, priority, propertyId, filter, id } = req.query as { status?: string; priority?: string; propertyId?: string; filter?: string; id?: string };
  const conditions = [];
  if (status) conditions.push(eq(maintenanceTicketsTable.status, status));
  if (priority) conditions.push(eq(maintenanceTicketsTable.priority, priority));
  if (propertyId) conditions.push(eq(maintenanceTicketsTable.propertyId, parseInt(propertyId)));
  const p = pageParams(req.query as Record<string, unknown>);
  let summary: Record<string, number> | null = null, total = 0;
  if (p) {
    if (id && parseId(id) !== null) conditions.push(eq(maintenanceTicketsTable.id, parseId(id)!));
    // Stat cards count every ticket; the filter tab only narrows the list.
    const [agg] = await db.select({
      total: sql<number>`count(*)::int`,
      emergency: sql<number>`count(*) filter (where ${maintenanceTicketsTable.priority} = 'emergency')::int`,
      approval: sql<number>`count(*) filter (where ${maintenanceTicketsTable.status} = 'awaiting_approval')::int`,
      open: sql<number>`count(*) filter (where ${maintenanceTicketsTable.status} not in ('resolved','completed','cancelled'))::int`,
      resolved: sql<number>`count(*) filter (where ${maintenanceTicketsTable.status} in ('resolved','completed'))::int`,
    }).from(maintenanceTicketsTable).where(conditions.length > 0 ? and(...conditions) : undefined);
    summary = agg;
    if (filter && filter !== "all") conditions.push(or(eq(maintenanceTicketsTable.status, filter), eq(maintenanceTicketsTable.priority, filter))!);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(maintenanceTicketsTable).where(conditions.length > 0 ? and(...conditions) : undefined);
    total = n;
  }

  const query = db
    .select(maintenanceSelect)
    .from(maintenanceTicketsTable)
    .leftJoin(propertiesTable, eq(maintenanceTicketsTable.propertyId, propertiesTable.id))
    .leftJoin(staffTable, eq(maintenanceTicketsTable.assignedToId, staffTable.id))
    .leftJoin(ownersTable, eq(propertiesTable.ownerId, ownersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  if (p) {
    const rows = await query.orderBy(desc(maintenanceTicketsTable.createdAt), desc(maintenanceTicketsTable.id)).limit(p.pageSize).offset(p.offset);
    return res.json(paged(rows.map(formatTicket), total, p, summary));
  }
  const rows = await query.orderBy(maintenanceTicketsTable.createdAt);
  return res.json(rows.map(formatTicket));
}));

router.get("/maintenance/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });

  const [row] = await db
    .select(maintenanceSelect)
    .from(maintenanceTicketsTable)
    .leftJoin(propertiesTable, eq(maintenanceTicketsTable.propertyId, propertiesTable.id))
    .leftJoin(staffTable, eq(maintenanceTicketsTable.assignedToId, staffTable.id))
    .leftJoin(ownersTable, eq(propertiesTable.ownerId, ownersTable.id))
    .where(eq(maintenanceTicketsTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(formatTicket(row));
}));

router.post("/maintenance", asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (Array.isArray(body.photos)) body.photos = JSON.stringify(body.photos);
  for (const key of ["cost","quoteAmount"]) if(body[key]!=null) body[key]=String(body[key]);
  const parsed = insertMaintenanceTicketSchema.safeParse(body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [row] = await db.insert(maintenanceTicketsTable).values(parsed.data).returning();

  await insertAuditLog({
    action: "create",
    entity: "maintenance",
    entityId: row.id,
    details: row,
    performedBy: req.headers["x-user-id"] as string,
  });

  res.status(201).json(formatTicket(row));

  // WhatsApp notification (fire-and-forget)
  try {
    const [prop] = await db.select({ name: propertiesTable.name, unitNumber: propertiesTable.unitNumber })
      .from(propertiesTable).where(eq(propertiesTable.id, row.propertyId));
    const propLabel = prop ? `${prop.name}${prop.unitNumber ? ` · Unit ${prop.unitNumber}` : ""}` : `Property #${row.propertyId}`;
    const priorityEmoji: Record<string, string> = { emergency: "🚨", high: "🔴", medium: "🟡", low: "🟢" };
    const emoji = priorityEmoji[row.priority] ?? "🔧";
    const msg = `${emoji} *New Maintenance Ticket*\n\nProperty: ${propLabel}\nIssue: ${row.issue}\nPriority: ${row.priority.charAt(0).toUpperCase() + row.priority.slice(1)}\n\nOpen Co-Host Pro to assign a technician.`;
    await notifyManagers(msg);
    if (row.assignedToId) await notifyStaffMember(row.assignedToId, msg);
  } catch (err: unknown) {
    console.error("[maintenance] WhatsApp notification error:", err instanceof Error ? err.message : err);
  }
  return;
}));

router.patch("/maintenance/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db.select().from(maintenanceTicketsTable).where(eq(maintenanceTicketsTable.id,id));
  if(!existing) return res.status(404).json({error:"Not found"});
  const body={...req.body};
  if(Array.isArray(body.photos)) body.photos=JSON.stringify(body.photos);
  for(const key of ["cost","quoteAmount"]) if(body[key]!=null) {
    if(!/^\d+(\.\d{1,2})?$/.test(String(body[key]))) return res.status(400).json({error:"Enter a valid non-negative amount"});
    body[key]=String(body[key]);
  }
  if(body.status && !["reported","in_progress","awaiting_approval","resolved","completed","cancelled"].includes(body.status)) return res.status(400).json({error:"Invalid maintenance status"});
  if(body.chargeType && !["owner","company","guest"].includes(body.chargeType)) return res.status(400).json({error:"Choose who pays: owner, company or guest"});
  if(["resolved","completed"].includes(body.status)) {
    if((body.chargeType ?? existing.chargeType)==="owner" && Number(body.quoteAmount ?? existing.quoteAmount)>0 && (body.ownerApproval ?? existing.ownerApproval)!=="approved") return res.status(400).json({error:"Owner approval is required before closing owner-funded work"});
    body.completedAt=new Date().toISOString(); body.status="completed";
  }
  const parsed=insertMaintenanceTicketSchema.partial().safeParse(body);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  const [row] = await db.update(maintenanceTicketsTable).set(parsed.data).where(eq(maintenanceTicketsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });

  await insertAuditLog({
    action: "patch",
    entity: "maintenance",
    entityId: id,
    details: req.body,
    performedBy: req.headers["x-user-id"] as string,
  });

  return res.json(formatTicket(row));
}));

router.delete("/maintenance/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });

  await db.delete(maintenanceTicketsTable).where(eq(maintenanceTicketsTable.id, id));

  await insertAuditLog({
    action: "delete",
    entity: "maintenance",
    entityId: id,
    performedBy: req.headers["x-user-id"] as string,
  });

  return res.status(204).send();
}));

export default router;
