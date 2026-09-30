import { Router } from "express";
import { db, staffTable, insertStaffSchema, cleaningTasksTable, maintenanceTicketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { insertAuditLog } from "../lib/audit";

const router = Router();

router.get("/staff", async (req, res) => {
  const rows = await db.select().from(staffTable).orderBy(staffTable.name);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.get("/staff/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(staffTable).where(eq(staffTable.id, id));
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.post("/staff", async (req, res) => {
  const parsed = insertStaffSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [row] = await db.insert(staffTable).values(parsed.data).returning();

  await insertAuditLog({
    action: "create",
    entity: "staff",
    entityId: row.id,
    details: row,
    performedBy: req.headers["x-user-id"] as string,
  });

  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.patch("/staff/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = insertStaffSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  if (!Object.keys(parsed.data).length) return res.status(400).json({ error: "Nothing to update" });
  const [row] = await db.update(staffTable).set(parsed.data).where(eq(staffTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });

  await insertAuditLog({
    action: "update",
    entity: "staff",
    entityId: id,
    details: req.body,
    performedBy: req.headers["x-user-id"] as string,
  });

  res.json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.delete("/staff/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [[cleaning], [ticket]] = await Promise.all([
    db.select({ id: cleaningTasksTable.id }).from(cleaningTasksTable).where(eq(cleaningTasksTable.assignedToId, id)).limit(1),
    db.select({ id: maintenanceTicketsTable.id }).from(maintenanceTicketsTable).where(eq(maintenanceTicketsTable.assignedToId, id)).limit(1),
  ]);
  if (cleaning || ticket) return res.status(409).json({ error: "This team member has task history. Mark them inactive instead of deleting." });
  await db.delete(staffTable).where(eq(staffTable.id, id));

  await insertAuditLog({
    action: "delete",
    entity: "staff",
    entityId: id,
    performedBy: req.headers["x-user-id"] as string,
  });

  res.status(204).send();
});

export default router;
