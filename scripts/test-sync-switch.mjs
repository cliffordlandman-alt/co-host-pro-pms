// SYNC_SCHEDULER=off: the API runs without the scheduled channel sync (restore tests, throwaway copies).
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
async function run(port, extra) {
  const env = { ...process.env, NODE_ENV: 'development', PORT: String(port), LOCAL_DATA_DIR: await mkdtemp(path.join(tmpdir(), 'yallapms-sync-')), MIGRATIONS_DIR: path.join(root, 'drizzle'), ...extra };
  delete env.DATABASE_URL; if (!extra.SYNC_SCHEDULER) delete env.SYNC_SCHEDULER;
  const child = spawn(process.execPath, [path.join(root, 'artifacts/api-server/dist/index.mjs')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  await new Promise(r => setTimeout(r, 16000)); child.kill('SIGTERM'); return logs;
}
try {
  const [off, on] = await Promise.all([run(3013, { SYNC_SCHEDULER: 'off' }), run(3014, {})]);
  assert.match(off, /Scheduled channel sync is off/); assert.doesNotMatch(off, /Starting scheduled sync/);
  assert.match(on, /Starting scheduled sync/, 'control: normal start-up still syncs');
  console.log('PASS: SYNC_SCHEDULER=off disables the scheduled channel sync; default unchanged');
} catch (e) { console.error(e); process.exitCode = 1; }
