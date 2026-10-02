// Test preload: records (and blocks) every network request the API makes to a non-local host.
import { appendFileSync } from 'node:fs';
const log = process.env.OUTBOUND_LOG;
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) { appendFileSync(log, url.replace(/\?.*$/, '') + '\n'); return new Response(JSON.stringify({ id: 'blocked-by-test', messages: [{ id: 'x' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  return real(input, init);
};
