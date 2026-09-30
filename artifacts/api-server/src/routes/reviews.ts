import { Router } from "express";
import { db, reviewsTable, propertiesTable, insertReviewSchema } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/reviews", async (req, res) => {
  const { propertyId } = req.query as { propertyId?: string };
  const conditions = propertyId ? [eq(reviewsTable.propertyId, parseInt(propertyId))] : [];
  const rows = await db
    .select({
      id: reviewsTable.id,
      propertyId: reviewsTable.propertyId,
      propertyName: propertiesTable.name,
      reservationId: reviewsTable.reservationId,
      guestName: reviewsTable.guestName,
      platform: reviewsTable.platform,
      rating: reviewsTable.rating,
      comment: reviewsTable.comment,
      response: reviewsTable.response,
      reviewDate: reviewsTable.reviewDate,
      createdAt: reviewsTable.createdAt,
    })
    .from(reviewsTable)
    .leftJoin(propertiesTable, eq(reviewsTable.propertyId, propertiesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(reviewsTable.reviewDate);
  res.json(rows.map(r => ({ ...r, rating: parseFloat(r.rating || "0"), createdAt: r.createdAt.toISOString() })));
});

router.post("/reviews", async (req, res) => {
  const parsed = insertReviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [row] = await db.insert(reviewsTable).values(parsed.data).returning();
  res.status(201).json({ ...row, rating: parseFloat(row.rating || "0"), createdAt: row.createdAt.toISOString() });
});

router.patch("/reviews/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.update(reviewsTable).set(req.body).where(eq(reviewsTable.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ ...row, rating: parseFloat(row.rating || "0"), createdAt: row.createdAt.toISOString() });
});

router.delete("/reviews/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(reviewsTable).where(eq(reviewsTable.id, id));
  res.status(204).send();
});

export default router;
