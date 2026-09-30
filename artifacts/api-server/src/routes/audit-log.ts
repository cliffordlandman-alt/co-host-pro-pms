import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireAdmin } from "../lib/auth-middleware";

const router = Router();

router.get("/audit-log", requireAdmin, async (_req, res) => {
  try {
    const logs = await db
      .select({
        id:          auditLogsTable.id,
        action:      auditLogsTable.action,
        entity:      auditLogsTable.entity,
        entityId:    auditLogsTable.entityId,
        details:     auditLogsTable.details,
        performedBy: auditLogsTable.performedBy,
        createdAt:   auditLogsTable.createdAt,
      })
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(200);

    res.json(logs.map(log => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
      details: log.details ? JSON.parse(log.details) : null,
    })));
  } catch (err) {
    console.error("Error fetching audit logs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
