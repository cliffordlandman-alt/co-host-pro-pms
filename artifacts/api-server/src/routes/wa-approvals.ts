// WhatsApp agent approvals (feature flag WA_APPROVALS=on). Drafts from the WhatsApp bot wait here for a person:
// approve / edit / always-approve (creates a rule) / decline. "Send" goes to the outbox; with OUTBOUND_DELIVERY off it
// stays "queued (delivery off)". Blocked categories (money, price, ... new_lead) can never have or use a rule.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { asyncHandler } from "../lib/asyncHandler";
import { getJson, setJson } from "../lib/ai-staff-store";
import { outboundDeliveryEnabled } from "../lib/outbound";
import { CATEGORIES, BLOCKED, DEFAULT_PROMPT, isBlocked, waEnabled, matchRule, newRule } from "../../../../lib/wa-approvals.mjs";

const router = Router();
const K = { drafts: "wa:drafts", rules: "wa:rules", audit: "wa:audit", outbox: "wa:outbox", prompt: "wa:prompt" };
type Draft = { id: string; contact: string; contactName?: string; category: string; text: string; reason: string; urgent?: boolean; status: "pending" | "sent" | "declined"; at: string; decidedBy?: string; decidedAt?: string; ruleId?: string | null; finalText?: string };
const isAdmin = (res: any) => ["admin", "super_admin"].includes(res.locals.user?.role);
const who = (res: any) => res.locals.user ? `${res.locals.user.name ?? res.locals.user.email} (#${res.locals.user.id})` : res.locals.bot ? `bot:${res.locals.bot}` : "system";

router.use("/wa", (_req, res, next) => waEnabled() ? next() : res.status(404).json({ error: "WhatsApp approvals are switched off for this company" }));
router.use("/ai-staff/bot/wa-drafts", (_req, res, next) => waEnabled() ? next() : res.status(404).json({ error: "WhatsApp approvals are switched off for this company" }));

async function audit(action: string, by: string, d: Partial<Draft> | null, extra: any = {}) {
  const log = await getJson<any[]>(K.audit, []);
  log.push({ id: randomUUID().slice(0, 10), at: new Date().toISOString(), action, by, draftId: d?.id ?? null, contact: d?.contactName ?? d?.contact ?? null, category: d?.category ?? null, ...extra });
  await setJson(K.audit, log.slice(-5000));
}
async function send(d: Draft, text: string, by: string, how: string) {
  const out = await getJson<any[]>(K.outbox, []);
  const status = outboundDeliveryEnabled() ? "queued (WhatsApp not connected)" : "queued (delivery off)";
  out.push({ id: randomUUID().slice(0, 10), draftId: d.id, to: d.contact, toName: d.contactName ?? null, text, channel: "whatsapp", status, at: new Date().toISOString(), approvedBy: by, how });
  await setJson(K.outbox, out.slice(-5000));
  d.status = "sent"; d.finalText = text; d.decidedBy = by; d.decidedAt = new Date().toISOString();
  return status;
}
/** Create a draft; auto-sends when an enabled, non-blocked rule matches. */
export async function addDraft(input: any, by: string) {
  const category = String(input?.category ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const text = String(input?.text ?? "").trim(), contact = String(input?.contact ?? "").trim();
  if (!CATEGORIES.includes(category)) throw Object.assign(new Error(`category must be one of: ${CATEGORIES.join(", ")}`), { status: 400 });
  if (!text || text.length > 4000 || !contact) throw Object.assign(new Error("contact and text (up to 4,000 characters) are required"), { status: 400 });
  const d: Draft = { id: randomUUID().slice(0, 10), contact, contactName: input?.contactName ? String(input.contactName).slice(0, 120) : undefined, category, text, reason: String(input?.reason ?? "").slice(0, 500), urgent: category === "urgent_breakdown", status: "pending", at: new Date().toISOString() };
  const drafts = await getJson<Draft[]>(K.drafts, []);
  await audit("drafted", by, d);
  const rule = matchRule(await getJson<any[]>(K.rules, []), d);
  if (rule) { const st = await send(d, d.text, `auto-rule ${rule.id}`, "auto"); d.ruleId = rule.id; await audit("auto-approved & sent", `auto-rule ${rule.id} (created by ${rule.createdBy})`, d, { ruleId: rule.id, outbox: st }); }
  drafts.push(d); await setJson(K.drafts, drafts.slice(-2000));
  return d;
}
const fail = (res: any, e: any) => res.status(e.status ?? 500).json({ error: e.message });

router.get("/wa/status", asyncHandler(async (_req, res) => { res.json({ enabled: true, delivery: outboundDeliveryEnabled() ? "on" : "off", whatsappConnected: false, categories: CATEGORIES, blocked: BLOCKED }); }));
router.get("/wa/prompt", asyncHandler(async (_req, res) => { res.json({ prompt: await getJson<string>(K.prompt, DEFAULT_PROMPT) }); }));
router.put("/wa/prompt", asyncHandler(async (req, res) => {
  if (!isAdmin(res)) return res.status(403).json({ error: "Admins only" });
  const p = String(req.body?.prompt ?? "").trim(); if (!p || p.length > 20000) return res.status(400).json({ error: "prompt required (up to 20,000 characters)" });
  await setJson(K.prompt, p); await audit("prompt updated", who(res), null); res.json({ ok: true });
}));
router.get("/wa/drafts", asyncHandler(async (req, res) => {
  const all = (await getJson<Draft[]>(K.drafts, [])).slice().reverse(), s = req.query.status ? String(req.query.status) : null;
  res.json((s ? all.filter(d => d.status === s) : all).map(d => ({ ...d, blocked: isBlocked(d.category) })));
}));
router.post("/wa/drafts", asyncHandler(async (req, res) => { if (!isAdmin(res)) return res.status(403).json({ error: "Admins only" }); try { res.status(201).json(await addDraft(req.body, who(res))); } catch (e) { fail(res, e); } }));
router.post("/ai-staff/bot/wa-drafts", asyncHandler(async (req, res) => { if (!res.locals.bot) return res.status(403).json({ error: "Bot key required" }); try { res.status(201).json(await addDraft(req.body, who(res))); } catch (e) { fail(res, e); } }));
router.get("/ai-staff/bot/wa-prompt", asyncHandler(async (_req, res) => { if (!res.locals.bot) return res.status(403).json({ error: "Bot key required" }); res.json({ prompt: await getJson<string>(K.prompt, DEFAULT_PROMPT) }); }));

router.post("/wa/drafts/:id/:decision", asyncHandler(async (req, res) => {
  if (!isAdmin(res)) return res.status(403).json({ error: "Admins only" });
  const decision = String(req.params.decision);
  if (!["approve", "decline", "always"].includes(decision)) return res.status(404).json({ error: "Unknown action" });
  const drafts = await getJson<Draft[]>(K.drafts, []), d = drafts.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "Draft not found" });
  if (d.status !== "pending") return res.status(409).json({ error: `Already ${d.status}` });
  const by = who(res);
  if (decision === "decline") { d.status = "declined"; d.decidedBy = by; d.decidedAt = new Date().toISOString(); await setJson(K.drafts, drafts); await audit("declined", by, d); return res.json(d); }
  const edited = req.body?.text != null ? String(req.body.text).trim() : null;
  if (edited !== null && (!edited || edited.length > 4000)) return res.status(400).json({ error: "text must be 1 to 4,000 characters" });
  let rule: any = null;
  if (decision === "always") {
    try { rule = { id: randomUUID().slice(0, 8), ...newRule({ contact: d.contact, contactName: d.contactName, category: d.category, scope: String(req.body?.scope ?? "contact") }, by) }; } catch (e) { return fail(res, e); }
  }
  const text = edited ?? d.text;
  const st = await send(d, text, by, decision === "always" ? "always-approve" : edited !== null && edited !== d.text ? "edited" : "approve");
  await setJson(K.drafts, drafts);
  await audit(edited !== null && edited !== d.text ? "edited & approved" : "approved", by, d, { outbox: st, ...(edited !== null && edited !== d.text ? { original: d.text, sent: text } : {}) });
  if (rule) { const rules = await getJson<any[]>(K.rules, []); rules.push(rule); await setJson(K.rules, rules); await audit("rule created", by, d, { ruleId: rule.id, scope: rule.scope }); }
  res.json({ draft: d, rule, outbox: st });
}));

router.get("/wa/rules", asyncHandler(async (_req, res) => { res.json(await getJson<any[]>(K.rules, [])); }));
router.patch("/wa/rules/:id", asyncHandler(async (req, res) => {
  if (!isAdmin(res)) return res.status(403).json({ error: "Admins only" });
  const rules = await getJson<any[]>(K.rules, []), r = rules.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ error: "Rule not found" });
  r.enabled = !!req.body?.enabled; if (isBlocked(r.category)) r.enabled = false;
  await setJson(K.rules, rules); await audit(r.enabled ? "rule switched on" : "rule switched off", who(res), { category: r.category, contact: r.contact ?? "all contacts" } as any, { ruleId: r.id }); res.json(r);
}));
router.delete("/wa/rules/:id", asyncHandler(async (req, res) => {
  if (!isAdmin(res)) return res.status(403).json({ error: "Admins only" });
  const rules = await getJson<any[]>(K.rules, []), r = rules.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ error: "Rule not found" });
  await setJson(K.rules, rules.filter(x => x.id !== r.id)); await audit("rule deleted", who(res), { category: r.category, contact: r.contact ?? "all contacts" } as any, { ruleId: r.id }); res.json({ ok: true });
}));
router.get("/wa/audit", asyncHandler(async (_req, res) => { res.json((await getJson<any[]>(K.audit, [])).slice().reverse().slice(0, 500)); }));
router.get("/wa/outbox", asyncHandler(async (_req, res) => { res.json((await getJson<any[]>(K.outbox, [])).slice().reverse().slice(0, 500)); }));
router.post("/wa/seed", asyncHandler(async (_req, res) => {
  if (!isAdmin(res)) return res.status(403).json({ error: "Admins only" });
  if ((await getJson<Draft[]>(K.drafts, [])).some(d => d.reason?.startsWith("[sample]"))) return res.json({ ok: true, seeded: 0 });
  const by = "sample data";
  const S = [
    { contact: "+971501110001", contactName: "Chef Ahmed, Al Safa Hotel", category: "service_booking", text: "Hi Ahmed, your service visit for the UC-L dishwasher is confirmed for Thursday 16 October between 9 and 11 AM. Our technician will call 30 minutes before arriving.", reason: "[sample] Customer asked to book the quarterly service." },
    { contact: "+971501110002", contactName: "Maria, Bay Bistro", category: "technician_eta", text: "Hi Maria, our technician Rajesh is on his way and should be with you in about 40 minutes.", reason: "[sample] Customer asked when the technician will arrive." },
    { contact: "+971501110003", contactName: "Omar, Marina Catering", category: "price", text: "Thanks Omar. Gareth will come back to you shortly with the price for the PT-M pass-through machine.", reason: "[sample] Customer asked for a price quote: money/price always needs manual approval." },
    { contact: "+971501110004", contactName: "Lina, Downtown Café", category: "thank_you", text: "You're welcome, Lina! Glad the machine is running well again. Let us know if you need anything.", reason: "[sample] Customer thanked the team after a repair." },
  ];
  for (const s of S) await addDraft(s, by);
  res.json({ ok: true, seeded: S.length });
}));
export default router;
