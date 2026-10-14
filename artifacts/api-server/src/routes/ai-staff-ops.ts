// AI staff, operations side (hybrid option C): escalation to the right person, staff end-of-day check-ins,
// daily reports (drafts, viewable in the app) and the in-PMS AI answer (only when OPENAI_API_KEY is set).
// Nothing here sends WhatsApp/email: check-ins and escalations are queued and shown in the app while
// OUTBOUND_DELIVERY is off.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { db, staffTable, reservationsTable, cleaningTasksTable, maintenanceTicketsTable, propertiesTable, notificationsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { insertAuditLog } from "../lib/audit";
import { dubaiToday } from "../lib/dubai-date";
import { getJson, setJson, getConfig } from "../lib/ai-staff-store";
import { BOTS } from "../../../../lib/ai-staff.mjs";

const router = Router();
export const OPS = "ai-staff:ops", ESC = "ai-staff:escalations", CHECKINS = "ai-staff:checkins", REPORTS = "ai-staff:reports", STATE = "ai-staff:schedule-state", CHECKS = "ai-staff:checks";
export const TOPICS = ["bookings", "finance", "guest", "housekeeping", "support"] as const;
type Person = { staffId?: number | null; name?: string | null; contact?: string | null };
export type Ops = { escalation: Record<string, Person>; checkinEnabled: boolean; checkinTime: string; checkinQuestion: string; reportEnabled: boolean; reportTime: string };
const defaults = (): Ops => ({ escalation: {}, checkinEnabled: true, checkinTime: "18:00", checkinQuestion: "Hi {name}, end of day check-in: what did you do today, anything unfinished or any problems?", reportEnabled: true, reportTime: "20:00" });
export const getOps = async (): Promise<Ops> => ({ ...defaults(), ...(await getJson<Partial<Ops>>(OPS, {})) });
const isAdmin = (res: any) => ["admin", "super_admin"].includes(res.locals.user?.role);
const outboundOn = () => process.env.OUTBOUND_DELIVERY === "on";
const delivery = () => outboundOn() ? "queued for WhatsApp (sender not connected yet)" : "not sent: outgoing messages are off (shown in the app only)";
const dubaiHM = (now = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
const id = () => randomUUID().slice(0, 12);

// ── Escalation ──
export async function escalate(topic: string, text: string, from: string) {
  const ops = await getOps(), to = ops.escalation[topic] ?? ops.escalation.support ?? null;
  const e = { id: id(), at: new Date().toISOString(), topic, from, text: text.slice(0, 2000), to, status: "open", delivery: to ? delivery() : "no person set for this topic: shown in the app" };
  const list = await getJson<any[]>(ESC, []); list.push(e); await setJson(ESC, list.slice(-1000));
  await db.insert(notificationsTable).values({ type: "ai_staff_escalation", title: `Needs a person: ${BOTS[topic]?.name ?? topic}${to?.name ? ` → ${to.name}` : ""}`, message: e.text.slice(0, 500), link: "/ai-staff?tab=escalations", entityType: "ai_staff_escalation", entityId: e.id }).catch(() => {});
  return e;
}

// ── Check-ins ──
export async function queueCheckins(date = dubaiToday()) {
  const ops = await getOps(), staff = (await db.select().from(staffTable)).filter(s => s.active);
  const list = await getJson<any[]>(CHECKINS, []); const made: any[] = [];
  for (const s of staff) {
    if (list.some(c => c.date === date && c.staffId === s.id)) continue;
    const c = { id: id(), date, staffId: s.id, staffName: s.name, role: s.role, contact: s.phone ? "phone on file" : s.email ? "email on file" : "no contact on file", question: ops.checkinQuestion.replace("{name}", s.name.split(" ")[0]), status: "waiting", delivery: delivery(), answer: null, answeredAt: null, answeredBy: null };
    list.push(c); made.push(c);
  }
  await setJson(CHECKINS, list.slice(-5000)); return made;
}

// ── Daily report ──
export async function buildReport(date = dubaiToday(), by = "schedule") {
  const [bookings, cleaning, tickets, properties] = await Promise.all([db.select().from(reservationsTable), db.select().from(cleaningTasksTable), db.select().from(maintenanceTicketsTable), db.select().from(propertiesTable)]);
  const pname = (pid: number) => properties.find(p => p.id === pid)?.name ?? `Property ${pid}`;
  const live = bookings.filter(b => !["cancelled", "blocked"].includes(String(b.status)));
  const arrivals = live.filter(b => b.checkIn === date).map(b => `${b.guestName ?? "Guest"} · ${pname(b.propertyId)}`);
  const departures = live.filter(b => b.checkOut === date).map(b => `${b.guestName ?? "Guest"} · ${pname(b.propertyId)}`);
  const clean = cleaning.filter(c => c.scheduledDate === date);
  const openTickets = tickets.filter(t => !["resolved", "closed", "completed"].includes(String(t.status)));
  const checks = await getJson<any>(CHECKS, { issues: [] }); const open = (checks.issues ?? []).filter((i: any) => !i.dismissed);
  const checkins = (await getJson<any[]>(CHECKINS, [])).filter(c => c.date === date);
  const escal = (await getJson<any[]>(ESC, [])).filter(e => e.status === "open");
  const sev = (s: string) => open.filter((i: any) => i.severity === s).length;
  const sections = {
    arrivals, departures,
    cleaning: { total: clean.length, done: clean.filter(c => ["clean", "done", "completed", "inspected"].includes(String(c.status))).length },
    maintenanceOpen: openTickets.map(t => `${pname(t.propertyId)}: ${t.issue} (${t.priority})`).slice(0, 30),
    checks: { high: sev("high"), medium: sev("medium"), low: sev("low"), top: open.filter((i: any) => i.severity === "high").slice(0, 10).map((i: any) => i.text) },
    checkins: { asked: checkins.length, answered: checkins.filter(c => c.status === "answered").length, answers: checkins.filter(c => c.answer).map(c => `${c.staffName}: ${c.answer}`) },
    escalationsOpen: escal.map(e => `${BOTS[e.topic]?.name ?? e.topic}: ${e.text.slice(0, 160)}`).slice(0, 20),
  };
  const L = (t: string, a: string[]) => a.length ? `${t}\n${a.map(x => `- ${x}`).join("\n")}` : `${t}: none`;
  const text = [`Daily report ${date}`, L(`Arrivals (${arrivals.length})`, arrivals), L(`Departures (${departures.length})`, departures),
    `Cleaning: ${sections.cleaning.done} of ${sections.cleaning.total} done`, L(`Open maintenance (${openTickets.length})`, sections.maintenanceOpen),
    `Bot checks: ${sections.checks.high} high, ${sections.checks.medium} medium, ${sections.checks.low} low`, ...(sections.checks.top.length ? [L("High", sections.checks.top)] : []),
    `Staff check-ins: ${sections.checkins.answered} of ${sections.checkins.asked} answered`, ...(sections.checkins.answers.length ? [L("Answers", sections.checkins.answers)] : []),
    L(`Waiting for a person (${escal.length})`, sections.escalationsOpen)].join("\n\n");
  const rep = { id: id(), date, generatedAt: new Date().toISOString(), by, status: "draft", sections, text };
  const list = (await getJson<any[]>(REPORTS, [])).filter(r => !(r.date === date && r.status === "draft")); list.push(rep); await setJson(REPORTS, list.slice(-90));
  return rep;
}

// ── Scheduler: every 5 minutes, Dubai time ──
export function startAiStaffSchedule() {
  const tick = async () => {
    try {
      const ops = await getOps(), st = await getJson<any>(STATE, {}), today = dubaiToday(), hm = dubaiHM();
      if (ops.checkinEnabled && hm >= ops.checkinTime && st.checkins !== today) { await queueCheckins(today); st.checkins = today; await setJson(STATE, st); }
      if (ops.reportEnabled && hm >= ops.reportTime && st.report !== today) { await buildReport(today); st.report = today; await setJson(STATE, st); }
    } catch { /* next tick */ }
  };
  setTimeout(tick, 90_000); setInterval(tick, 5 * 60_000);
}
/** After a daily check run: new high-severity issues go to the person for that topic (once each). */
export async function escalateNewHigh(issues: any[]) {
  const st = await getJson<any>(STATE, {}); const seen = new Set<string>(st.escalated ?? []);
  for (const i of issues) if (i.severity === "high" && !i.dismissed && !seen.has(i.id)) { await escalate(i.bot, `Bot check: ${i.text}`, "daily checks"); seen.add(i.id); }
  st.escalated = [...seen].slice(-2000); await setJson(STATE, st);
}

// ── In-PMS AI answer (hybrid) ──
export const aiConnected = () => !!process.env.OPENAI_API_KEY;
export async function aiAnswer(bot: string, text: string, history: { from: string; text: string }[]) {
  const checks = ((await getJson<any>(CHECKS, { issues: [] })).issues ?? []).filter((i: any) => i.bot === bot && !i.dismissed).slice(0, 20).map((i: any) => `- ${i.text}`).join("\n");
  const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const r = await ai.chat.completions.create({ model: "gpt-4o-mini", temperature: 0.2, max_tokens: 600, messages: [
    { role: "system", content: `${BOTS[bot].instructions}\nYou work inside a property management system. You cannot change data or message guests/owners; suggest steps for a person. If you do not know or it needs a decision, start your reply with "ESCALATE:" and say what the person must decide.\nOpen checks for your area today:\n${checks || "none"}` },
    ...history.slice(-10).map(m => ({ role: (m.from === "user" ? "user" : "assistant") as "user" | "assistant", content: m.text })),
    { role: "user", content: text } ] });
  return r.choices[0]?.message?.content?.trim() || "ESCALATE: no answer";
}

// ── Routes (people) ──
router.get("/ai-staff/ops", asyncHandler(async (_req, res) => {
  const staff = (await db.select().from(staffTable)).filter(s => s.active).map(s => ({ id: s.id, name: s.name, role: s.role }));
  res.json({ ...(await getOps()), staff, topics: TOPICS, outbound: outboundOn() ? "on" : "off", ai: aiConnected() ? "connected" : "not connected" });
}));
router.put("/ai-staff/ops", asyncHandler(async (req, res) => {
  if (!isAdmin(res)) return res.status(403).json({ error: "Admins only" });
  const ops = await getOps(), b = req.body ?? {}, hm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (b.checkinTime !== undefined) { if (!hm.test(b.checkinTime)) return res.status(400).json({ error: "Check-in time must be HH:MM" }); ops.checkinTime = b.checkinTime; }
  if (b.reportTime !== undefined) { if (!hm.test(b.reportTime)) return res.status(400).json({ error: "Report time must be HH:MM" }); ops.reportTime = b.reportTime; }
  if (b.checkinEnabled !== undefined) ops.checkinEnabled = !!b.checkinEnabled;
  if (b.reportEnabled !== undefined) ops.reportEnabled = !!b.reportEnabled;
  if (b.checkinQuestion !== undefined) { const q = String(b.checkinQuestion).trim(); if (!q || q.length > 500) return res.status(400).json({ error: "Question: 1–500 characters" }); ops.checkinQuestion = q; }
  if (b.escalation && typeof b.escalation === "object") for (const [t, p] of Object.entries<any>(b.escalation)) {
    if (!(TOPICS as readonly string[]).includes(t)) continue;
    if (!p || (!p.staffId && !p.name)) { delete ops.escalation[t]; continue; }
    let name = p.name ? String(p.name).slice(0, 100) : null;
    if (p.staffId) { const s = (await db.select().from(staffTable)).find(x => x.id === Number(p.staffId)); if (!s) return res.status(400).json({ error: `${t}: staff member not found` }); name = s.name; }
    ops.escalation[t] = { staffId: p.staffId ? Number(p.staffId) : null, name, contact: p.contact ? String(p.contact).slice(0, 120) : null };
  }
  await setJson(OPS, ops);
  await insertAuditLog({ action: "update", entity: "ai_staff_ops", entityId: 0, details: { checkinTime: ops.checkinTime, reportTime: ops.reportTime, escalationTopics: Object.keys(ops.escalation) }, performedBy: req.headers["x-user-id"] as string });
  res.json(ops);
}));
router.get("/ai-staff/escalations", asyncHandler(async (_req, res) => { res.json((await getJson<any[]>(ESC, [])).slice().reverse().slice(0, 200)); }));
router.post("/ai-staff/escalations", asyncHandler(async (req, res) => {
  if (res.locals.bot) return res.status(403).json({ error: "People only" });
  const topic = String(req.body?.topic ?? ""), text = String(req.body?.text ?? "").trim();
  if (!(TOPICS as readonly string[]).includes(topic) || !text) return res.status(400).json({ error: "topic and text required" });
  res.status(201).json(await escalate(topic, text, res.locals.user?.email ?? "user"));
}));
router.post("/ai-staff/escalations/:id/resolve", asyncHandler(async (req, res) => {
  if (res.locals.bot) return res.status(403).json({ error: "People only" });
  const list = await getJson<any[]>(ESC, []), e = list.find(x => x.id === req.params.id); if (!e) return res.status(404).json({ error: "Not found" });
  e.status = "resolved"; e.resolvedAt = new Date().toISOString(); e.resolvedBy = res.locals.user?.email ?? null; e.note = req.body?.note ? String(req.body.note).slice(0, 1000) : null;
  await setJson(ESC, list); res.json(e);
}));
router.get("/ai-staff/checkins", asyncHandler(async (req, res) => {
  const date = /^\d{4}-\d\d-\d\d$/.test(String(req.query.date)) ? String(req.query.date) : dubaiToday();
  res.json({ date, checkins: (await getJson<any[]>(CHECKINS, [])).filter(c => c.date === date) });
}));
router.post("/ai-staff/checkins/run", asyncHandler(async (_req, res) => { if (res.locals.bot) return res.status(403).json({ error: "People only" }); res.json({ queued: (await queueCheckins()).length }); }));
router.post("/ai-staff/checkins/:id/answer", asyncHandler(async (req, res) => {
  if (res.locals.bot) return res.status(403).json({ error: "People only" });
  const a = String(req.body?.answer ?? "").trim(); if (!a || a.length > 4000) return res.status(400).json({ error: "Write the answer (up to 4,000 characters)" });
  const list = await getJson<any[]>(CHECKINS, []), c = list.find(x => x.id === req.params.id); if (!c) return res.status(404).json({ error: "Not found" });
  c.answer = a; c.status = "answered"; c.answeredAt = new Date().toISOString(); c.answeredBy = res.locals.user?.email ?? null;
  await setJson(CHECKINS, list); res.json(c);
}));
router.get("/ai-staff/reports", asyncHandler(async (_req, res) => { res.json((await getJson<any[]>(REPORTS, [])).slice().reverse().slice(0, 60)); }));
router.post("/ai-staff/reports/generate", asyncHandler(async (req, res) => {
  if (res.locals.bot) return res.status(403).json({ error: "People only" });
  res.status(201).json(await buildReport(dubaiToday(), res.locals.user?.email ?? "user"));
}));
// ── Bots: ask a person ──
router.post("/ai-staff/bot/escalate", asyncHandler(async (req, res) => {
  const bot = res.locals.bot; if (!bot) return res.status(403).json({ error: "Bot key required" });
  const text = String(req.body?.text ?? "").trim(); if (!text) return res.status(400).json({ error: "text required" });
  res.status(201).json(await escalate(bot, text, `bot:${bot}`));
}));
export default router;
