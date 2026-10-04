import { Router } from "express";
import { db, airbnbPayoutLinesTable, reservationsTable, propertiesTable } from "@workspace/db";
import { or, eq, like, sql } from "drizzle-orm";
import { asyncHandler } from "../lib/asyncHandler";
import { dubaiToday } from "../lib/dubai-date";
import { insertAuditLog } from "../lib/audit";
import { parsePayoutFile, reconcilePayouts } from "../../../../lib/payout-recon.mjs";

// Airbnb payout check (Accounting): import the Airbnb earnings file and the reservation breakdowns, then see every
// payout matched to its booking, with mismatches, payouts without a booking and bookings without a payout flagged.
const router = Router();
const num = (v: string | null) => (v == null ? null : Number(v));

async function loadLines() {
  const rows = await db.select().from(airbnbPayoutLinesTable);
  return rows.map(r => ({ ...r, amount: Number(r.amount), cohostPayout: num(r.cohostPayout), guestPaid: num(r.guestPaid), importedAt: r.importedAt.toISOString() }));
}
export async function payoutCheck() {
  const [lines, bookings, properties] = await Promise.all([
    loadLines(),
    db.select({ id: reservationsTable.id, externalId: reservationsTable.externalId, propertyId: reservationsTable.propertyId, guestName: reservationsTable.guestName, checkIn: reservationsTable.checkIn, checkOut: reservationsTable.checkOut,
      platform: reservationsTable.platform, status: reservationsTable.status, currency: reservationsTable.currency, financeMode: reservationsTable.financeMode, grossAmount: reservationsTable.grossAmount, channelFees: reservationsTable.channelFees, cohostPayout: reservationsTable.cohostPayout })
      .from(reservationsTable).where(or(eq(reservationsTable.platform, "airbnb"), like(reservationsTable.externalId, "airbnb:%"))),
    db.select({ id: propertiesTable.id, name: propertiesTable.name, currency: propertiesTable.currency }).from(propertiesTable),
  ]);
  const result = reconcilePayouts({ lines, bookings, properties, today: dubaiToday() });
  const files = (source: string) => { const l = lines.filter(x => x.source === source); return { lines: l.length, files: [...new Set(l.map(x => x.fileName).filter(Boolean))], lastImport: l.map(x => x.importedAt).sort().at(-1) ?? null }; };
  return { ...result, imported: { earnings: files("earnings"), breakdown: files("breakdown") } };
}

router.get("/accounting/payout-check", asyncHandler(async (_req, res) => { res.json(await payoutCheck()); }));

function parse(body: any) {
  const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 120) : null;
  if (typeof body?.csv !== "string" || body.csv.length > 5_000_000) throw new Error("Choose a CSV file smaller than 5 MB");
  return { fileName, ...parsePayoutFile(body.csv, fileName ?? "") };
}
router.post("/accounting/payout-check/preview", asyncHandler(async (req, res) => {
  let f; try { f = parse(req.body); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  const existing = new Map((await loadLines()).map(l => [l.id, l]));
  const same = (a: any, b: any) => ["amount", "cohostPayout", "status", "payoutDate", "currency", "cohostBasis"].every(k => String(a[k] ?? "") === String(b[k] ?? ""));
  res.json({ format: f.format, fileName: f.fileName, bookings: f.lines.filter(l => l.kind === "booking").length, transfers: f.lines.filter(l => l.kind === "transfer").length,
    added: f.lines.filter(l => !existing.has(l.id)).length, changed: f.lines.filter(l => existing.has(l.id) && !same(existing.get(l.id), l)).length, unchanged: f.lines.filter(l => existing.has(l.id) && same(existing.get(l.id), l)).length,
    currencies: [...new Set(f.lines.map(l => l.currency))].sort() });
}));
router.post("/accounting/payout-check/import", asyncHandler(async (req, res) => {
  let f; try { f = parse(req.body); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  const s = (n: number | null) => (n == null ? null : n.toFixed(2));
  await db.transaction(async tx => {
    for (const l of f.lines) {
      const values = { ...l, amount: s(l.amount)!, cohostPayout: s(l.cohostPayout), guestPaid: s(l.guestPaid), fileName: f.fileName };
      const { id: _id, ...set } = values;
      await tx.insert(airbnbPayoutLinesTable).values(values).onConflictDoUpdate({ target: airbnbPayoutLinesTable.id, set: { ...set, importedAt: sql`now()` } });
    }
  });
  await insertAuditLog({ action: "create", entity: "airbnb_payout_import", entityId: 0, details: { format: f.format, fileName: f.fileName, lines: f.lines.length }, performedBy: res.locals.user?.email });
  const check = await payoutCheck();
  res.json({ format: f.format, lines: f.lines.length, counts: check.counts });
}));

export default router;
