import { Router } from "express";
import { db, documentsTable, propertiesTable, insertDocumentSchema } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/documents", async (req, res) => {
  const { propertyId, category } = req.query as { propertyId?: string; category?: string };
  const rows = await db
    .select({
      id: documentsTable.id,
      name: documentsTable.name,
      type: documentsTable.type,
      category: documentsTable.category,
      propertyId: documentsTable.propertyId,
      propertyName: propertiesTable.name,
      entityType: documentsTable.entityType,
      entityId: documentsTable.entityId,
      fileUrl: documentsTable.fileUrl,
      fileSize: documentsTable.fileSize,
      expiryDate: documentsTable.expiryDate,
      status: documentsTable.status,
      notes: documentsTable.notes,
      createdAt: documentsTable.createdAt,
    })
    .from(documentsTable)
    .leftJoin(propertiesTable, eq(documentsTable.propertyId, propertiesTable.id))
    .orderBy(desc(documentsTable.createdAt));

  let result = rows;
  if (propertyId) result = result.filter(r => r.propertyId === parseInt(propertyId));
  if (category) result = result.filter(r => r.category === category);
  res.json(result);
});

router.post("/documents", async (req, res) => {
  const parsed = insertDocumentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data" });
  const [row] = await db.insert(documentsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/documents/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.update(documentsTable).set(req.body).where(eq(documentsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/documents/:id", async (req, res) => {
  await db.delete(documentsTable).where(eq(documentsTable.id, parseInt(req.params.id)));
  res.status(204).end();
});

export default router;
