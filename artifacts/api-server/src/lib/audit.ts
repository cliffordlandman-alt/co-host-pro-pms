import { db, auditLogsTable } from "@workspace/db";

export async function insertAuditLog(log: {
  action: "create" | "update" | "delete" | "patch";
  entity: string;
  entityId: number;
  details?: any;
  performedBy?: string;
}) {
  try {
    await db.insert(auditLogsTable).values({
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      details: log.details ? JSON.stringify(log.details) : null,
      performedBy: log.performedBy || "system",
    });
  } catch (error) {
    console.error("Failed to insert audit log:", error);
  }
}
