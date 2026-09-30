// Test-only preload (node --import): serves channel iCal feeds from local files instead of the internet.
import { readFileSync } from 'node:fs';
import path from 'node:path';
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const platform = /airbnb\./.test(url.hostname) ? 'airbnb' : /booking\.com$/.test(url.hostname) ? 'booking_com' : /vrbo\.com$/.test(url.hostname) ? 'vrbo' : null;
  if (!platform) return real(input, init);
  // A per-listing fixture (e.g. airbnb-111.ics for .../calendar/ical/111.ics) wins over the shared <platform>.ics.
  const listing = (url.pathname.match(/\/(\d+)\.ics$/) || [])[1];
  for (const name of [listing && `${platform}-${listing}.ics`, `${platform}.ics`].filter(Boolean)) {
    try { return new Response(readFileSync(path.join(process.env.ICAL_FIXTURE_DIR, name), 'utf8'), { status: 200, headers: { 'Content-Type': 'text/calendar' } }); } catch {}
  }
  return new Response('not found', { status: 404 });
};
