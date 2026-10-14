// AI staff (13 Oct 2026): role definitions, plan tiers and the rule-based checks. The "brain" is the company's own
// external bot (e.g. a Grok Bot); this app only relays messages to it, exposes scoped read access and takes its
// changes as proposals a person approves. Nothing here sends guest or owner messages.
export const PLANS = { starter: ['bookings', 'support'], growth: ['bookings', 'support', 'finance', 'guest'], full_ops: ['bookings', 'support', 'finance', 'guest', 'housekeeping'] };
const R = (path) => ({ method: 'GET', path });
export const BOTS = {
  bookings: { name: 'Bookings bot', role: 'Checks bookings and keeps them complete',
    instructions: 'You are the bookings assistant for this property management company. Check bookings for missing guest names, amounts, contacts and currency, duplicates, and calendar blocks that are not real stays. Use only figures the user or the channel gives you; never invent amounts. Propose fixes as changes for a person to approve. Never message guests or owners.',
    reads: [/^\/reservations(\/\d+)?$/, /^\/properties(\/\d+)?$/, /^\/calendar-sync/, /^\/ai-staff\/checks$/],
    writes: [['PATCH', /^\/reservations\/\d+$/], ['POST', /^\/reservations$/]] },
  finance: { name: 'Finance bot', role: 'Checks owner statements, fees and payouts',
    instructions: 'You are the finance assistant for this company. Check owner statements, management fees against each property\'s fee settings, payout gaps and month close. Flag mismatches with the exact figures and where they come from. Keep currencies separate. Propose corrections for a person to approve; never mark anything paid or send statements.',
    reads: [/^\/accounting\//, /^\/reports\/income/, /^\/properties(\/\d+)?$/, /^\/reservations(\/\d+)?$/, /^\/owners$/, /^\/ai-staff\/checks$/],
    writes: [['PATCH', /^\/accounting\/transactions\/\d+$/], ['POST', /^\/accounting\/transactions$/], ['PUT', /^\/accounting\/settings\/\d+$/], ['POST', /^\/accounting\/statements\/generate$/]] },
  guest: { name: 'Guest bot', role: 'Drafts guest replies from confirmed property info',
    instructions: 'You draft replies to guests using only confirmed property information (check-in and check-out times, wifi, house rules, FAQ). If something is not in the property information, say it needs confirming. You only draft: a person sends the message.',
    reads: [/^\/properties(\/\d+)?$/, /^\/reservations\/\d+$/, /^\/settings$/], writes: [] },
  housekeeping: { name: 'Housekeeping & maintenance bot', role: 'Tracks cleaning and maintenance, chases gaps',
    instructions: 'You track cleaning tasks and maintenance tickets: what is open, overdue or missing photos or notes. Chase missing items and escalate urgent ones to the operations manager inside this app. Propose task updates for a person to approve.',
    reads: [/^\/cleaning(\/\d+)?$/, /^\/maintenance(\/\d+)?$/, /^\/staff$/, /^\/properties$/, /^\/ai-staff\/checks$/],
    writes: [['PATCH', /^\/cleaning\/\d+$/], ['PATCH', /^\/maintenance\/\d+$/], ['POST', /^\/maintenance$/]] },
  support: { name: 'Support bot', role: 'Helps people use the PMS',
    instructions: 'You help staff use this property management system: where things are, how to do a task, what a figure means. You do not change data.',
    reads: [/^\/ai-staff\/checks$/, /^\/settings$/], writes: [] },
};
export const botList = () => Object.entries(BOTS).map(([id, b]) => ({ id, name: b.name, role: b.role, instructions: b.instructions }));
export function botEnabled(config, id) { const plan = PLANS[config?.plan] ?? PLANS.full_ops; return plan.includes(id) && config?.enabled?.[id] !== false; }
export const canRead = (bot, path) => !!BOTS[bot]?.reads.some(re => re.test(path));
export const canWrite = (bot, method, path) => !!BOTS[bot]?.writes.some(([m, re]) => m === method && re.test(path));

const NAMELESS = /^(airbnb guest|guest|reserved|not available)\b/i;
const live = r => !['cancelled', 'blocked'].includes(r.status);
const isBlockLike = r => /blocked dates|not available/i.test(r.guestName || '');
/** Rule-based checks: no AI needed. data = { bookings, properties, settings, statements, earnings, today } */
export function runChecks({ bookings = [], properties = [], settings = [], statements = [], earnings = [], today }) {
  const issues = [], prop = id => properties.find(p => p.id === id), add = (bot, kind, severity, ref, text) => issues.push({ id: `${kind}:${ref}`, bot, kind, severity, ref, text });
  const since = new Date(Date.parse(today) - 60 * 864e5).toISOString().slice(0, 10), soon = new Date(Date.parse(today) + 14 * 864e5).toISOString().slice(0, 10);
  const rel = bookings.filter(b => live(b) && !isBlockLike(b) && b.checkOut >= since);
  for (const b of rel) {
    const p = prop(b.propertyId), label = `${p?.name ?? 'Property ' + b.propertyId} · ${b.checkIn}→${b.checkOut} (#${b.id})`;
    if (!b.guestName || NAMELESS.test(b.guestName)) add('bookings', 'missing-name', 'medium', `r${b.id}`, `No guest name: ${label}`);
    if (b.financeMode !== 'inclusive-v1') add('bookings', 'missing-amounts', b.checkOut <= today ? 'high' : 'medium', `r${b.id}`, `Amounts not entered: ${label}`);
    if (!b.currency && !p?.currency) add('bookings', 'missing-currency', 'low', `r${b.id}`, `No currency on booking or property: ${label}`);
    if (b.checkIn >= today && b.checkIn <= soon && !b.guestPhone && !b.guestEmail && b.platform !== 'airbnb') add('bookings', 'missing-contact', 'low', `r${b.id}`, `No phone or email before arrival: ${label}`);
  }
  for (let i = 0; i < rel.length; i++) for (let j = i + 1; j < rel.length; j++) {
    const a = rel[i], b = rel[j];
    if (a.propertyId === b.propertyId && a.checkIn < b.checkOut && b.checkIn < a.checkOut) add('bookings', 'overlap', 'high', `r${a.id}-r${b.id}`, `Overlapping stays at ${prop(a.propertyId)?.name ?? a.propertyId}: #${a.id} (${a.guestName}, ${a.checkIn}→${a.checkOut}) and #${b.id} (${b.guestName}, ${b.checkIn}→${b.checkOut}) - duplicate, extension or double booking?`);
  }
  const byExt = new Map(); for (const b of bookings.filter(live)) if (b.externalId) byExt.set(b.externalId, [...(byExt.get(b.externalId) ?? []), b]);
  for (const [ext, list] of byExt) if (list.length > 1) add('bookings', 'duplicate-code', 'high', ext, `Same channel code ${ext} on ${list.length} active bookings: ${list.map(b => '#' + b.id).join(', ')}`);
  // Finance
  for (const b of rel.filter(b => b.financeMode === 'inclusive-v1')) {
    const s = settings.find(x => x.propertyId === b.propertyId); if (!s || b.managementPercent == null || s.managementFeePercent == null) continue;
    if (Math.abs(Number(b.managementPercent) - Number(s.managementFeePercent)) > 0.001 && (s.feeBasis ?? 'gross') === (b.feeBasis ?? s.feeBasis ?? 'gross')) add('finance', 'fee-mismatch', 'medium', `r${b.id}`, `Fee ${b.managementPercent}% on booking #${b.id} (${prop(b.propertyId)?.name}) but the property's rule is ${s.managementFeePercent}%`);
  }
  for (const st of statements) if (st.status === 'draft' && Number(st.ownerPayout) < -0.05) add('finance', 'negative-statement', 'high', `s${st.id}`, `Draft statement ${st.month} for ${prop(st.propertyId)?.name ?? st.propertyId}: owner balance ${Number(st.ownerPayout).toFixed(2)} ${st.currency ?? ''} is negative`);
  const lastMonth = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  for (const p of properties.filter(p => p.ownerId)) {
    const had = bookings.some(b => b.propertyId === p.id && live(b) && !isBlockLike(b) && b.checkOut.startsWith(lastMonth));
    if (had && !statements.some(s => s.propertyId === p.id && s.month === lastMonth)) add('finance', 'month-close', 'medium', `p${p.id}-${lastMonth}`, `No owner statement for ${lastMonth} at ${p.name} although stays checked out`);
  }
  const codes = new Set(bookings.map(b => b.externalId).filter(Boolean));
  for (const e of earnings) if (e.status === 'paid' && e.confirmationCode && !codes.has(`airbnb:${e.confirmationCode}`)) add('finance', 'payout-no-booking', 'medium', e.confirmationCode, `Airbnb paid ${Number(e.amount).toFixed(2)} ${e.currency} for ${e.confirmationCode} (${e.guestName}) but there is no booking with that code`);
  return issues;
}
