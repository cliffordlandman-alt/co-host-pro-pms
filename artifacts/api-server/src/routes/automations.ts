import { Router } from "express";
import { db, automationsTable, insertAutomationSchema } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/automations", async (_req, res) => {
  const rows = await db.select().from(automationsTable).orderBy(automationsTable.createdAt);
  res.json(rows.map(r=>({...r,configuredEnabled:r.enabled,enabled:false,runtimeState:"not_connected"})));
});

router.post("/automations", async (req, res) => {
  if(req.body.enabled !== false) return res.status(503).json({error:"Custom automation execution is not connected. Save a disabled draft."});
  const parsed = insertAutomationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data" });
  const [row] = await db.insert(automationsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/automations/:id", async (req, res) => {
  if(req.body.enabled === true) return res.status(503).json({error:"Custom automation execution is not connected"});
  const id = parseInt(req.params.id);
  const [row] = await db.update(automationsTable).set({ ...req.body }).where(eq(automationsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/automations/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(automationsTable).where(eq(automationsTable.id, id));
  res.status(204).end();
});

export default router;
