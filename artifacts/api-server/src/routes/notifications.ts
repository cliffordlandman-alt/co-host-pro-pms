import { Router } from "express";
import { db, notificationsTable, insertNotificationSchema } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/notifications", async (_req, res) => {
  const rows = await db.select().from(notificationsTable).orderBy(desc(notificationsTable.createdAt)).limit(50);
  res.json(rows);
});

router.post("/notifications", async (req, res) => {
  const parsed = insertNotificationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data" });
  const [row] = await db.insert(notificationsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/notifications/:id/read", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.update(notificationsTable).set({ read: true }).where(eq(notificationsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.post("/notifications/read-all", async (_req, res) => {
  await db.update(notificationsTable).set({ read: true });
  res.json({ ok: true });
});

router.delete("/notifications/:id", async (req, res) => {
  await db.delete(notificationsTable).where(eq(notificationsTable.id, parseInt(req.params.id)));
  res.status(204).end();
});

export default router;
