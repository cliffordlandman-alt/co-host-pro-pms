// Monthly automatic owner statements (owners.auto_statements, off by default). Checked hourly; from the 6th of a
// month it generates the previous month's statements for each owner who has it on, once per owner and month.
// A statement is emailed only when lib/auto-statements.mjs allows it (owner email + auto-send + OUTBOUND_DELIVERY=on
// + an earlier automatic statement approved in the app); otherwise it stays a draft and an in-app notification asks
// for approval. Nothing is ever sent with OUTBOUND_DELIVERY off.
import { db, ownersTable, propertiesTable, ownerStatementsTable, appSettingsTable, notificationsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { autoStatementDecision } from "../../../../lib/auto-statements.mjs";
import { refreshOwnerStatements } from "./owner-statements";
import { outboundDeliveryEnabled } from "./outbound";
import { dubaiToday } from "./dubai-date";
import { insertAuditLog } from "./audit";
import { DEFAULT_FROM_EMAIL } from "../../../../lib/brand.mjs";
import { statementEmail } from "../../../../lib/owner-emails.mjs";
import { documentCompanyName } from "../routes/app-settings";

const RUN_KEY = "autoStatementsLastRun";

async function lastRuns(): Promise<Record<string, string>> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, RUN_KEY));
  return row?.value && typeof row.value === "object" ? (row.value as Record<string, string>) : {};
}

/** Emails one statement to its owner. Refuses unless outgoing delivery is on and email is configured. */
export async function emailStatement(owner: { name: string; email: string | null }, st: any, propertyName: string): Promise<void> {
  if (!outboundDeliveryEnabled()) throw new Error("Outgoing messages are switched off on this system");
  if (!owner.email) throw new Error("The owner has no email address");
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Owner email delivery is not configured");
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL;
  const { subject, html } = statementEmail({ ownerName: owner.name, propertyName, statement: st, company: await documentCompanyName() });
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [owner.email], subject, html }) });
  if (!res.ok) throw new Error("Failed to send email");
}

export async function runAutoStatements(today = dubaiToday()) {
  const owners = (await db.select().from(ownersTable)).filter(o => o.autoStatements);
  if (!owners.length) return [];
  const runs = await lastRuns();
  const outbound = outboundDeliveryEnabled();
  const report: any[] = [];
  for (const owner of owners) {
    const props = await db.select().from(propertiesTable).where(and(eq(propertiesTable.ownerId, owner.id), eq(propertiesTable.status, "active")));
    const statements = await db.select().from(ownerStatementsTable).where(eq(ownerStatementsTable.ownerId, owner.id));
    const d = autoStatementDecision({ today, owner, statements, outbound, lastRunMonth: runs[String(owner.id)] ?? null });
    if (!d.run) { report.push({ ownerId: owner.id, ...d }); continue; }
    const result = props.length ? await refreshOwnerStatements(d.month, { propertyIds: props.map(p => p.id), auto: true }) : { generated: 0, statements: [], skipped: [] };
    const sent: number[] = [], waiting: number[] = [], failed: string[] = [];
    for (const st of result.statements as any[]) {
      const name = props.find(p => p.id === st.propertyId)?.name ?? "Property";
      if (d.send) {
        try {
          await emailStatement(owner, st, name);
          await db.update(ownerStatementsTable).set({ status: "sent", sentAt: today, emailedAt: new Date() }).where(and(eq(ownerStatementsTable.id, st.id), eq(ownerStatementsTable.status, "draft")));
          sent.push(st.id);
          continue;
        } catch (e) { failed.push(`${name}: ${(e as Error).message}`); }
      }
      waiting.push(st.id);
      await db.insert(notificationsTable).values({ type: "owner_statement_approval", title: `Owner statement ready to approve · ${name} · ${d.month}`,
        message: `${owner.name}'s automatic statement for ${d.month} is a draft. ${d.waitReason ?? (failed.length ? `Not emailed: ${failed.at(-1)}` : "")} Approve it with "Mark as Sent" under Owner statements.`.trim(),
        link: `/accounting?month=${d.month}`, entityType: "owner_statement", entityId: String(st.id) });
    }
    runs[String(owner.id)] = d.month;
    await db.insert(appSettingsTable).values({ key: RUN_KEY, value: runs }).onConflictDoUpdate({ target: appSettingsTable.key, set: { value: runs, updatedAt: new Date() } });
    await insertAuditLog({ action: "create", entity: "auto_owner_statements", entityId: owner.id, details: { month: d.month, generated: result.generated, sent, waiting, skipped: result.skipped.length, failed }, performedBy: "system" });
    report.push({ ownerId: owner.id, month: d.month, generated: result.generated, sent, waiting, skipped: result.skipped, failed, waitReason: d.waitReason });
  }
  return report;
}

export function startAutoStatements() {
  const tick = () => runAutoStatements().catch(err => console.error("[Auto statements] failed:", err instanceof Error ? err.message : err));
  setInterval(tick, 60 * 60 * 1000);
  setTimeout(tick, 30000);
}
