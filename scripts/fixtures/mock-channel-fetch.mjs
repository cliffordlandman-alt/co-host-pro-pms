// Test-only preload (node --import): serves channel iCal feeds from local files instead of the internet.
import { readFileSync } from 'node:fs';
import path from 'node:path';
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const platform = /airbnb\./.test(url.hostname) ? 'airbnb' : /booking\.com$/.test(url.hostname) ? 'booking_com' : /vrbo\.com$/.test(url.hostname) ? 'vrbo' : null;
  if (!platform) return real(input, init);
  try { return new Response(readFileSync(path.join(process.env.ICAL_FIXTURE_DIR, `${platform}.ics`), 'utf8'), { status: 200, headers: { 'Content-Type': 'text/calendar' } }); }
  catch { return new Response('not found', { status: 404 }); }
};
