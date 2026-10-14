// AI staff: the PMS side of the company's own bots (see lib/ai-staff.mjs). People chat here; messages are queued per
// bot and relayed (email / webhook, only when BOT_RELAY=on and an address is set); the bot reads them with its key,
// replies, and proposes changes that a person approves. Rule-based checks run daily without any AI.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, reservationsTable, propertiesTable, propertySettingsTable, ownerStatementsTable, airbnbEarningsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { insertAuditLog } from "../lib/audit";
import { dubaiToday } from "../lib/dubai-date";
import { getJson, setJson, getConfig, CONFIG_KEY, newBotKey, type StaffConfig } from "../lib/ai-staff-store";
import { BOTS, PLANS, botList, botEnabled, canWrite, runChecks } from "../../../../lib/ai-staff.mjs";
import { BRAND } from "../../../../lib/brand.mjs";
import { escalateNewHigh, aiConnected, aiAnswer, escalate } from "./ai-staff-ops";

const router = Router();
const THREADS = "ai-staff:messages", PROPOSALS = "ai-staff:proposals", CHECKS = "ai-staff:checks";
type Msg = { id: string; bot: string; from: "user" | "bot"; userId?: number | null; userName?: string | null; text: string; at: string; replyTo?: string | null; status?: string; relay?: string };
type Proposal = { id: string; bot: string; title: string; reason?: string; method: string; path: string; body: any; status: "pending" | "approved" | "rejected" | "failed"; at: string; decidedBy?: string | null; decidedAt?: string | null; result?: any };
const isAdmin = (res: any) => ["admin", "super_admin"].includes(res.locals.user?.role);
const relayOn = () => process.env.BOT_RELAY === "on";

async function relay(bot: string, msg: Msg, cfg: StaffConfig): Promise<string> {
  const c = cfg.bots?.[bot] ?? {};
  if (!relayOn()) return "queued (relay off: the bot collects it with its key)";
  const out: string[] = [];
  if (c.webhookUrl) {
    try { const r = await fetch(c.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: BRAND, bot, messageId: msg.id, text: msg.text, from: msg.userName, at: msg.at, replyVia: "POST /api/ai-staff/bot/reply with X-Bot-Key" }) }); out.push(`webhook ${r.status}`); }
    catch (e) { out.push(`webhook failed: ${(e as Error).message}`); }
  }
  if (c.email && process.env.RESEND_API_KEY) {
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || `${BRAND} <noreply@yallastay.ae>`, to: [c.email], subject: `[${BRAND} ${BOTS[bot].name}] message ${msg.id}`,
          text: `${msg.text}\n\n-- From ${msg.userName ?? "a user"} at ${msg.at}. Reply in the app: POST /api/ai-staff/bot/reply {"messageId":"${msg.id}","text":"..."} with your X-Bot-Key.` }) });
      out.push(`email ${r.status}`);
    } catch (e) { out.push(`email failed: ${(e as Error).message}`); }
  }
  return out.length ? out.join(", ") : "queued (no webhook or email set for this bot)";
}

async function checkData() {
  const [bookings, properties, settings, statements, earnings] = await Promise.all([db.select().from(reservationsTable), db.select().from(propertiesTable), db.select().from(propertySettingsTable), db.select().from(ownerStatementsTable), db.select().from(airbnbEarningsTable)]);
  return { bookings, properties, settings, statements, earnings, today: dubaiToday() };
}
export async function runAndStoreChecks(by = "schedule") {
  const prev = await getJson<any>(CHECKS, { issues: [] });
  const dismissed = new Set<string>((prev.issues ?? []).filter((i: any) => i.dismissed).map((i: any) => i.id));
  const cfg = await getConfig();
  const issues = runChecks(await checkData()).filter((i: any) => botEnabled(cfg, i.bot)).map((i: any) => ({ ...i, dismissed: dismissed.has(i.id) }));
  const value = { runAt: new Date().toISOString(), by, issues };
  await setJson(CHECKS, value);
  if (by === "schedule") await escalateNewHigh(issues).catch(() => {});
  return value;
}
export function startAiStaffChecks() {
  const run = () => runAndStoreChecks().catch(() => {});
  setTimeout(run, 60_000); setInterval(run, 24 * 3600_000);
}

// ── For people in the app ──
router.get("/ai-staff/bots", asyncHandler(async (_req, res) => {
  const cfg = await getConfig();
  res.json({ plan: cfg.plan, plans: PLANS, relay: relayOn() ? "on" : "off", ai: aiConnected() ? "connected" : "not connected", outbound: "Guest and owner messages are never sent by bots.",
    bots: botList().map(b => ({ ...b, enabled: botEnabled(cfg, b.id), inPlan: (PLANS[cfg.plan] ?? []).includes(b.id), email: cfg.bots?.[b.id]?.email ?? null, webhookUrl: cfg.bots?.[b.id]?.webhookUrl ?? null, hasKey: !!cfg.bots?.[b.id]?.keyHash, keyCreatedAt: cfg.bots?.[b.id]?.keyCreatedAt ?? null })) });
}));
router.put("/ai-staff/config", asyncHandler(async (req, res) => {
  if (!isAdmin(res)) return res.status(403).json({ error: "Admins only" });
  const cfg = await getConfig(), b = req.body ?? {};
  if (b.plan !== undefined) { if (!PLANS[b.plan]) return res.status(400).json({ error: "Plan must be starter, growth or full_ops" }); cfg.plan = b.plan; }
  if (b.enabled && typeof b.enabled === "object") for (const [k, v] of Object.entries(b.enabled)) if (BOTS[k]) cfg.enabled[k] = !!v;
  if (b.bots && typeof b.bots === "object") for (const [k, v] of Object.entries<any>(b.bots)) {
    if (!BOTS[k]) continue; const c = cfg.bots[k] ??= {};
    if (v.email !== undefined) { if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return res.status(400).json({ error: `${k}: email looks wrong` }); c.email = v.email || null; }
    if (v.webhookUrl !== undefined) { if (v.webhookUrl && !/^https:\/\//.test(v.webhookUrl)) return res.status(400).json({ error: `${k}: webhook must start with https://` }); c.webhookUrl = v.webhookUrl || null; }
  }
  await setJson(CONFIG_KEY, cfg);
  await insertAuditLog({ action: "update", entity: "ai_staff_config", entityId: 0, details: { plan: cfg.plan, enabled: cfg.enabled, bots: Object.fromEntries(Object.entries(cfg.bots).map(([k, v]) => [k, { email: v.email, webhookUrl: v.webhookUrl, hasKey: !!v.keyHash }])) }, performedBy: req.headers["x-user-id"] as string });
  res.json({ ok: true });
}));
router.post("/ai-staff/bots/:bot/key", asyncHandler(async (req, res) => {
  if (!isAdmin(res)) return res.status(403).json({ error: "Admins only" });
  const bot = String(req.params.bot); if (!BOTS[bot]) return res.status(404).json({ error: "Unknown bot" });
  const cfg = await getConfig(), { key, hash } = newBotKey(bot);
  cfg.bots[bot] = { ...(cfg.bots[bot] ?? {}), keyHash: hash, keyCreatedAt: new Date().toISOString() };
  await setJson(CONFIG_KEY, cfg);
  await insertAuditLog({ action: "update", entity: "ai_staff_key", entityId: 0, details: { bot, rotated: true }, performedBy: req.headers["x-user-id"] as string });
  res.json({ bot, key, note: "Shown once. Give it to the bot; it sends it as the X-Bot-Key header. Creating a new key replaces this one." });
}));
router.get("/ai-staff/checks", asyncHandler(async (_req, res) => { res.json(await getJson(CHECKS, { runAt: null, issues: [] })); }));
router.post("/ai-staff/checks/run", asyncHandler(async (req, res) => {
  if (res.locals.bot) return res.status(403).json({ error: "People only" });
  res.json(await runAndStoreChecks(res.locals.user?.email ?? "user"));
}));
router.post("/ai-staff/checks/:id/dismiss", asyncHandler(async (req, res) => {
  const v = await getJson<any>(CHECKS, { issues: [] }); const i = (v.issues ?? []).find((x: any) => x.id === req.params.id);
  if (!i) return res.status(404).json({ error: "Not found" }); i.dismissed = req.body?.dismissed !== false; await setJson(CHECKS, v); res.json(i);
}));
router.get("/ai-staff/messages/:bot", asyncHandler(async (req, res) => {
  const all = await getJson<Msg[]>(THREADS, []); res.json(all.filter(m => m.bot === req.params.bot).slice(-200));
}));
router.post("/ai-staff/messages/:bot", asyncHandler(async (req, res) => {
  const bot = String(req.params.bot), cfg = await getConfig(), text = String(req.body?.text ?? "").trim();
  if (!BOTS[bot]) return res.status(404).json({ error: "Unknown bot" });
  if (!botEnabled(cfg, bot)) return res.status(403).json({ error: "This bot is not in your plan or is switched off" });
  if (!text || text.length > 4000) return res.status(400).json({ error: "Write a message (up to 4,000 characters)" });
  const msg: Msg = { id: randomUUID().slice(0, 12), bot, from: "user", userId: res.locals.user?.id ?? null, userName: res.locals.user?.email ?? null, text, at: new Date().toISOString(), status: "waiting" };
  const all = await getJson<Msg[]>(THREADS, []);
  // Hybrid: a connected Grok bot (has a key) gets the message; otherwise the in-PMS AI answers when a key is set.
  if (!cfg.bots?.[bot]?.keyHash && aiConnected()) {
    msg.relay = "answered by the in-app AI";
    let answer: string;
    try { answer = await aiAnswer(bot, text, all.filter(m => m.bot === bot)); } catch (e) { answer = `ESCALATE: the AI could not answer (${(e as Error).message.slice(0, 120)})`; }
    msg.status = "answered";
    const reply: Msg = { id: randomUUID().slice(0, 12), bot, from: "bot", text: answer.replace(/^ESCALATE:\s*/, "Passed to a person: "), at: new Date().toISOString(), replyTo: msg.id };
    if (/^ESCALATE:/.test(answer)) await escalate(bot, `${text}\n\nAI: ${answer.replace(/^ESCALATE:\s*/, "")}`, `ai:${bot}`);
    all.push(msg, reply); await setJson(THREADS, all.slice(-1000));
    return res.status(201).json(msg);
  }
  msg.relay = cfg.bots?.[bot]?.keyHash ? await relay(bot, msg, cfg) : "AI not connected yet: the message waits until a bot is connected (bot key) or an OpenAI key is added";
  all.push(msg); await setJson(THREADS, all.slice(-1000));
  res.status(201).json(msg);
}));
router.get("/ai-staff/proposals", asyncHandler(async (_req, res) => { res.json((await getJson<Proposal[]>(PROPOSALS, [])).slice().reverse()); }));
router.post("/ai-staff/proposals/:id/:decision", asyncHandler(async (req, res) => {
  if (!["approve", "reject"].includes(String(req.params.decision))) return res.status(404).json({ error: "Not found" });
  if (res.locals.bot) return res.status(403).json({ error: "Only a person can approve" });
  const list = await getJson<Proposal[]>(PROPOSALS, []), p = list.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.status !== "pending") return res.status(409).json({ error: `Already ${p.status}` });
  p.decidedBy = res.locals.user?.email ?? null; p.decidedAt = new Date().toISOString();
  if (req.params.decision === "reject") p.status = "rejected";
  else {
    if (!canWrite(p.bot, p.method, p.path)) { p.status = "failed"; p.result = { error: "Not allowed for this bot" }; }
    else {
      // Applied with the approving person's own login, through the normal API (same checks and audit log).
      const port = process.env.PORT || "3001";
      const r = await fetch(`http://127.0.0.1:${port}/api${p.path}`, { method: p.method, headers: { "Content-Type": "application/json", Authorization: String(req.headers.authorization ?? "") }, body: JSON.stringify(p.body ?? {}) });
      const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t.slice(0, 500); }
      p.status = r.ok ? "approved" : "failed"; p.result = r.ok ? { status: r.status } : { status: r.status, error: j?.error ?? j };
    }
  }
  await setJson(PROPOSALS, list);
  await insertAuditLog({ action: "update", entity: "ai_staff_proposal", entityId: 0, details: { id: p.id, bot: p.bot, title: p.title, method: p.method, path: p.path, status: p.status }, performedBy: req.headers["x-user-id"] as string });
  res.status(p.status === "failed" ? 422 : 200).json(p);
}));

// ── For the bot (X-Bot-Key) ──
router.get("/ai-staff/bot/inbox", asyncHandler(async (_req, res) => {
  const bot = res.locals.bot; if (!bot) return res.status(403).json({ error: "Bot key required" });
  const all = await getJson<Msg[]>(THREADS, []), checks = await getJson<any>(CHECKS, { issues: [] });
  res.json({ bot, name: BOTS[bot].name, instructions: BOTS[bot].instructions, rules: { reads: BOTS[bot].reads.map((r: RegExp) => String(r)), proposals: BOTS[bot].writes.map(([m, r]: [string, RegExp]) => `${m} ${String(r)}`), outbound: "Never message guests or owners." },
    waiting: all.filter(m => m.bot === bot && m.from === "user" && m.status === "waiting"), checks: (checks.issues ?? []).filter((i: any) => i.bot === bot && !i.dismissed), checksRunAt: checks.runAt });
}));
router.post("/ai-staff/bot/reply", asyncHandler(async (req, res) => {
  const bot = res.locals.bot; if (!bot) return res.status(403).json({ error: "Bot key required" });
  const text = String(req.body?.text ?? "").trim(); if (!text || text.length > 8000) return res.status(400).json({ error: "text required (up to 8,000 characters)" });
  const all = await getJson<Msg[]>(THREADS, []), q = req.body?.messageId ? all.find(m => m.id === req.body.messageId && m.bot === bot) : null;
  if (req.body?.messageId && !q) return res.status(404).json({ error: "Message not found for this bot" });
  if (q) q.status = "answered";
  const msg: Msg = { id: randomUUID().slice(0, 12), bot, from: "bot", text, at: new Date().toISOString(), replyTo: q?.id ?? null };
  all.push(msg); await setJson(THREADS, all.slice(-1000)); res.status(201).json(msg);
}));
router.post("/ai-staff/bot/proposals", asyncHandler(async (req, res) => {
  const bot = res.locals.bot; if (!bot) return res.status(403).json({ error: "Bot key required" });
  const { title, reason, method, path, body } = req.body ?? {};
  const m = String(method ?? "").toUpperCase(), pth = String(path ?? "").replace(/^\/api/, "");
  if (!title || !canWrite(bot, m, pth)) return res.status(400).json({ error: `Not a change this bot may propose. Allowed: ${BOTS[bot].writes.map(([x, r]: [string, RegExp]) => `${x} ${r}`).join("; ") || "none"}` });
  const list = await getJson<Proposal[]>(PROPOSALS, []);
  const p: Proposal = { id: randomUUID().slice(0, 12), bot, title: String(title).slice(0, 200), reason: reason ? String(reason).slice(0, 2000) : undefined, method: m, path: pth, body: body ?? {}, status: "pending", at: new Date().toISOString() };
  list.push(p); await setJson(PROPOSALS, list.slice(-500)); res.status(201).json(p);
}));
export default router;
