import { Router } from "express";
import { db, messagesTable, reservationsTable, propertiesTable, insertMessageSchema } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/messages", async (req, res) => {
  const { reservationId } = req.query as { reservationId?: string };
  if (!reservationId) {
    // Return latest message per reservation (inbox view)
    const rows = await db
      .select({
        id: messagesTable.id,
        reservationId: messagesTable.reservationId,
        guestName: reservationsTable.guestName,
        propertyName: propertiesTable.name,
        platform: reservationsTable.platform,
        sender: messagesTable.sender,
        body: messagesTable.body,
        readAt: messagesTable.readAt,
        createdAt: messagesTable.createdAt,
      })
      .from(messagesTable)
      .leftJoin(reservationsTable, eq(messagesTable.reservationId, reservationsTable.id))
      .leftJoin(propertiesTable, eq(reservationsTable.propertyId, propertiesTable.id))
      .orderBy(desc(messagesTable.createdAt));
    return res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  }
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.reservationId, parseInt(reservationId)))
    .orderBy(messagesTable.createdAt);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/messages", async (req, res) => {
  if(req.body.sender !== "note") return res.status(503).json({error:"Channel messaging is not connected. Save an internal note instead."});
  const parsed = insertMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [row] = await db.insert(messagesTable).values(parsed.data).returning();
  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.patch("/messages/:id/read", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db
    .update(messagesTable)
    .set({ readAt: new Date().toISOString() })
    .where(eq(messagesTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ ...row, createdAt: row.createdAt.toISOString() });
});

export default router;
