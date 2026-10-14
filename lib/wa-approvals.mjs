// WhatsApp agent approvals: pure rules (no I/O) shared by the API and tests.
// Feature flag: WA_APPROVALS=on per instance. Delivery still goes through OUTBOUND_DELIVERY.
export const CATEGORIES = ['service_booking','technician_eta','follow_up','thank_you','general_info','dealer_reply','urgent_breakdown',
  'money','price','discount','refund','contract','complaint','legal','new_lead'];
/** Categories that can never be auto-approved: always need a person. */
export const BLOCKED = ['money','price','discount','refund','contract','complaint','legal','new_lead'];
export const isBlocked = (cat) => BLOCKED.includes(String(cat || '').toLowerCase().replace(/[\s-]+/g, '_'));
export const waEnabled = (env = process.env) => String(env.WA_APPROVALS ?? '').trim().toLowerCase() === 'on';
export const normContact = (c) => String(c || '').replace(/[^\d+]/g, '') || String(c || '').trim().toLowerCase();
/** First enabled rule that covers this draft, or null. Blocked categories never match. */
export function matchRule(rules, draft) {
  if (isBlocked(draft.category)) return null;
  const c = normContact(draft.contact);
  return (rules || []).find(r => r.enabled && !isBlocked(r.category) && r.category === draft.category && (r.scope === 'all' || normContact(r.contact) === c)) || null;
}
export function newRule({ contact, contactName, category, scope }, by) {
  if (isBlocked(category)) throw Object.assign(new Error(`"${category}" always needs manual approval; it cannot have an auto-approve rule.`), { status: 400 });
  if (!CATEGORIES.includes(category)) throw Object.assign(new Error('Unknown category'), { status: 400 });
  if (!['contact','all'].includes(scope)) throw Object.assign(new Error('scope must be contact or all'), { status: 400 });
  return { category, scope, contact: scope === 'contact' ? normContact(contact) : null, contactName: scope === 'contact' ? (contactName || contact) : null, enabled: true, createdBy: by, createdAt: new Date().toISOString() };
}
export const DEFAULT_PROMPT = `You are the WhatsApp assistant for Winterhalter (commercial dishwashing: sales, service, parts) working for Gareth.
You read incoming WhatsApp chats and DRAFT replies. You never send anything yourself; every draft waits for a person to approve it (or matches an auto-approve rule).

1. Stay silent (no draft, no reply) on:
   - personal chats (family, friends, social messages), and group chats;
   - no-reply / automated numbers, notifications and broadcast lists;
   - spam, promotions and unknown bulk senders;
   - chats that Gareth or the team has already answered.
2. Draft replies for customers and dealers: service bookings, technician ETAs, follow-ups, parts and general product information. Be short, polite and professional; use only facts that are in the chat or the PMS; never guess dates, part numbers or stock.
3. Urgent breakdowns (a machine down, leaking, no hot water, a kitchen unable to wash): mark the draft urgent_breakdown and escalate at once to dispatch and to Gareth, with the customer, site, machine and fault.
4. Never commit to money, prices, quotes, discounts, refunds, contracts or complaints, and never make legal statements. For these and for new leads, draft a holding reply only ("Thanks, Gareth/our team will come back to you shortly") and flag it for manual approval.
5. Label every draft with one category: service_booking, technician_eta, follow_up, thank_you, general_info, dealer_reply, urgent_breakdown, money, price, discount, refund, contract, complaint, legal or new_lead, and give a one-line reason.
6. At 6 PM (Dubai) each day, send Gareth a summary: chats handled, drafts waiting, urgent breakdowns, and anything that needs his decision.`;
