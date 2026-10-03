// Navigation (dashboard redesign, 3 Oct 2026): every menu entry, bottom-bar entry and dashboard tile opens a real
// page (a route in App.tsx), and every page still has a menu entry (nothing removed; Dynamic Pricing stays hidden).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const web = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../artifacts/yallastay/src');
const app = readFileSync(path.join(web, 'App.tsx'), 'utf8');
const layout = readFileSync(path.join(web, 'components/layout/app-layout.tsx'), 'utf8');
const today = readFileSync(path.join(web, 'components/today/TodayDashboard.tsx'), 'utf8');
const accounting = readFileSync(path.join(web, 'pages/accounting.tsx'), 'utf8');
const routes = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1]));
const routed = href => { const p = href.split('?')[0]; return routes.has(p) || [...routes].some(r => r.includes(':') && new RegExp('^' + r.replace(/:[^/]+/g, '[^/]+') + '$').test(p)); };
const menu = [...layout.matchAll(/href: "([^"]+)"/g)].map(m => m[1]);
assert.ok(menu.length >= 30, 'menu entries found');
for (const h of menu) assert.ok(routed(h), `menu entry ${h} opens a page`);
for (const h of [...layout.matchAll(/<Link href="([^"]+)"/g)].map(m => m[1])) assert.ok(routed(h), `footer link ${h}`);
// Every page reachable from the menu (or the sidebar footer), except sign-in pages, details and hidden pricing.
const exempt = new Set(['/', '/login', '/signup', '/forgot-password', '/owner-portal', '/setup', '/pricing']);
const reachable = new Set([...menu, ...[...layout.matchAll(/<Link href="([^"]+)"/g)].map(m => m[1])].map(h => h.split('?')[0]));
for (const r of routes) if (!exempt.has(r) && !r.includes(':')) assert.ok(reachable.has(r), `page ${r} still has a menu entry`);
// Accounting tabs opened from the menu exist.
for (const tab of [...layout.matchAll(/\/accounting\?tab=(\w+)/g)].map(m => m[1])) assert.ok(accounting.includes(`TabsTrigger value="${tab}"`) && accounting.includes(`"${tab}"`), `Accounting tab ${tab}`);
// Bottom bar: Today, Calendar, Bookings, Income (+ More).
const bottom = layout.slice(layout.indexOf('const BOTTOM_NAV'), layout.indexOf('];', layout.indexOf('const BOTTOM_NAV')));
assert.deepEqual([...bottom.matchAll(/label: "([^"]+)"/g)].map(m => m[1]), ['Today', 'Calendar', 'Bookings', 'Income']);
// Dashboard: the seven main jobs, each a page or the entry form; top tiles link to real pages.
const jobs = [...today.matchAll(/\{label:'([^']+)',hint:'[^']*',icon:\w+,tone:'[^']*',(href:'([^']+)'|onClick:)/g)];
assert.deepEqual(jobs.map(j => j[1]), ['Calendar', 'Bookings', 'Verify bookings', 'Add income or expense', 'Owners', 'Owner statements', 'Income per property']);
for (const j of jobs) if (j[3]) assert.ok(routed(j[3]), `tile ${j[1]} -> ${j[3]}`); else assert.match(today, /onClick:\(\)=>setEntryOpen\(true\)/, 'Add income or expense opens the entry form');
assert.match(today, /<EntryDialog open=\{entryOpen\}/);
for (const h of ['/verify-bookings', '/accounting', '/income']) assert.ok(today.includes(h) && routed(h));
console.log(`PASS: ${menu.length} menu entries, the bottom bar and the 7 dashboard tiles all open real pages; every page keeps a menu entry`);
