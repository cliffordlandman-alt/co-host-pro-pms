import { Router } from "express";
import { db, subscriptionsTable, insertSubscriptionSchema } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";

const router = Router();

router.get("/subscriptions",    requireAdmin, async (_req, res) => {
  const rows = await db.select().from(subscriptionsTable).orderBy(subscriptionsTable.createdAt);
  res.json(rows);
});

router.post("/subscriptions",   requireAdmin, async (req, res) => {
  const parsed = insertSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data" });
  const [row] = await db.insert(subscriptionsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/subscriptions/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [row] = await db.update(subscriptionsTable).set(req.body).where(eq(subscriptionsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/subscriptions/:id", requireAdmin, async (req, res) => {
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.id, parseInt(String(req.params.id))));
  res.status(204).end();
});

export default router;
