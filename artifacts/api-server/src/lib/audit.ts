import { db, auditLogsTable } from "@workspace/db";
import { redactSecrets } from "../../../../lib/redact.mjs";

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
      // Never store private feed links or credentials (request bodies are logged as-is by several routes).
      details: log.details ? JSON.stringify(redactSecrets(log.details)) : null,
      performedBy: log.performedBy || "system",
    });
  } catch (error) {
    console.error("Failed to insert audit log:", error);
  }
}
