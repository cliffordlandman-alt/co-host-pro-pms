import { Router } from "express";
import { db, cleaningTasksTable, propertiesTable, staffTable, insertCleaningTaskSchema } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { notifyManagers, notifyStaffMember } from "../lib/whatsapp";
import { insertAuditLog } from "../lib/audit";
import { asyncHandler } from "../lib/asyncHandler";
import { parseId } from "../lib/parseId";

const router = Router();

// ─── Shared column selection ──────────────────────────────────────────────────

const cleaningSelect = {
  photos: cleaningTasksTable.photos,
  price: cleaningTasksTable.price,
  scheduledTime: cleaningTasksTable.scheduledTime,
  id: cleaningTasksTable.id,
  propertyId: cleaningTasksTable.propertyId,
  propertyName: propertiesTable.name,
  reservationId: cleaningTasksTable.reservationId,
  assignedToId: cleaningTasksTable.assignedToId,
  assignedToName: staffTable.name,
  status: cleaningTasksTable.status,
  scheduledDate: cleaningTasksTable.scheduledDate,
  completedAt: cleaningTasksTable.completedAt,
  checklist: cleaningTasksTable.checklist,
  notes: cleaningTasksTable.notes,
  createdAt: cleaningTasksTable.createdAt,
} as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/cleaning", asyncHandler(async (req, res) => {
  const { status, propertyId } = req.query as { status?: string; propertyId?: string };
  const conditions = [];
  if (status) conditions.push(eq(cleaningTasksTable.status, status));
  if (propertyId) conditions.push(eq(cleaningTasksTable.propertyId, parseInt(propertyId)));

  const rows = await db
    .select(cleaningSelect)
    .from(cleaningTasksTable)
    .leftJoin(propertiesTable, eq(cleaningTasksTable.propertyId, propertiesTable.id))
    .leftJoin(staffTable, eq(cleaningTasksTable.assignedToId, staffTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(cleaningTasksTable.scheduledDate);

  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
}));

router.get("/cleaning/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });

  const [row] = await db
    .select(cleaningSelect)
    .from(cleaningTasksTable)
    .leftJoin(propertiesTable, eq(cleaningTasksTable.propertyId, propertiesTable.id))
    .leftJoin(staffTable, eq(cleaningTasksTable.assignedToId, staffTable.id))
    .where(eq(cleaningTasksTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json({ ...row, createdAt: row.createdAt.toISOString() });
}));

router.post("/cleaning", asyncHandler(async (req, res) => {
  const parsed = insertCleaningTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [row] = await db.insert(cleaningTasksTable).values(parsed.data).returning();

  await insertAuditLog({
    action: "create",
    entity: "cleaning",
    entityId: row.id,
    details: row,
    performedBy: req.headers["x-user-id"] as string,
  });

  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });

  // WhatsApp notification (fire-and-forget after response is sent)
  try {
    const [prop] = await db.select({ name: propertiesTable.name, unitNumber: propertiesTable.unitNumber })
      .from(propertiesTable).where(eq(propertiesTable.id, row.propertyId));
    const propLabel = prop ? `${prop.name}${prop.unitNumber ? ` · Unit ${prop.unitNumber}` : ""}` : `Property #${row.propertyId}`;
    const dateStr = row.scheduledDate ?? "TBD";

    if (row.assignedToId) {
      const [staff] = await db.select({ name: staffTable.name })
        .from(staffTable).where(eq(staffTable.id, row.assignedToId));
      const staffName = staff?.name ?? "there";
      const staffMsg = `🧹 *New Cleaning Task*\n\nHi ${staffName}, you've been assigned a cleaning task.\n\nProperty: ${propLabel}\nDate: ${dateStr}${row.notes ? `\nNotes: ${row.notes}` : ""}\n\nPlease confirm you've received this in YallaPMS.`;
      await notifyStaffMember(row.assignedToId, staffMsg);
    }

    const managerMsg = `🧹 *Cleaning Task Created*\n\nProperty: ${propLabel}\nDate: ${dateStr}${row.assignedToId ? "" : "\n⚠️ Not yet assigned to a cleaner"}\n\nView in YallaPMS.`;
    await notifyManagers(managerMsg);
  } catch (err: unknown) {
    console.error("[cleaning] WhatsApp notification error:", err instanceof Error ? err.message : err);
  }
  return;
}));

router.patch("/cleaning/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });

  const body={...req.body};
  if(body.status && !["dirty","scheduled","pending","in_progress","completed","approved","cancelled"].includes(body.status)) return res.status(400).json({error:"Invalid cleaning status"});
  if(body.photos && (!Array.isArray(body.photos) || body.photos.length>8 || body.photos.some((p:any)=>typeof p!=="string" || p.length>1500000 || !/^data:image\/(jpeg|png|webp);base64,/.test(p)))) return res.status(400).json({error:"Use up to eight JPEG, PNG or WebP photos under 1 MB each"});
  if(body.price!=null && !/^\d+(\.\d{1,2})?$/.test(String(body.price))) return res.status(400).json({error:"Enter a valid cleaning price"});
  if(["completed","approved"].includes(body.status)) body.completedAt=new Date().toISOString();
  const parsed=insertCleaningTaskSchema.partial().safeParse(body);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  const [row] = await db.update(cleaningTasksTable).set(parsed.data).where(eq(cleaningTasksTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });

  await insertAuditLog({
    action: "patch",
    entity: "cleaning",
    entityId: id,
    details: req.body,
    performedBy: req.headers["x-user-id"] as string,
  });

  return res.json({ ...row, createdAt: row.createdAt.toISOString() });
}));

export default router;
