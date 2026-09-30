// Migration 0012 check: unique owner statement per property/month, but only when no duplicates exist;
// existing duplicates are reported and never deleted.
import { createRequire } from 'node:module';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const req = createRequire(path.join(root, 'lib/db/package.json'));
const { PGlite } = await import(req.resolve('@electric-sql/pglite'));
const { drizzle } = await import(req.resolve('drizzle-orm/pglite'));
const { migrate } = await import(req.resolve('drizzle-orm/pglite/migrator'));
const full = path.join(root, 'drizzle');
const journal = JSON.parse(await readFile(path.join(full, 'meta/_journal.json'), 'utf8'));
const idx = journal.entries.findIndex(e => e.tag.startsWith('0012_'));
const before = await mkdtemp(path.join(tmpdir(), 'yallapms-mig12-'));
await cp(full, before, { recursive: true });
await writeFile(path.join(before, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, idx) }));
async function run(withDupes) {
  const client = new PGlite(); const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: before });
    const p = (await client.query(`INSERT INTO properties (name, unit_number) VALUES ('P', 'P') RETURNING id`)).rows[0].id;
    const add = (month, status) => client.query(`INSERT INTO owner_statements (owner_id, property_id, month, status) VALUES (1, $1, $2, $3)`, [p, month, status]);
    await add('2026-08', 'paid'); await add('2026-09', 'draft');
    if (withDupes) await add('2026-09', 'sent');
    const q = client.query.bind(client);
    await migrate(db, { migrationsFolder: full });
    const idxRows = (await q(`SELECT indexname FROM pg_indexes WHERE tablename = 'owner_statements'`)).rows.map(r => r.indexname);
    const count = (await q(`SELECT count(*)::int AS n FROM owner_statements`)).rows[0].n;
    return { idxRows, count, q, p };
  } finally { setTimeout(() => client.close(), 0); }
}
try {
  const clean = await run(false);
  assert.ok(clean.idxRows.includes('owner_statements_property_month_unique'), 'unique index created when data is clean');
  await assert.rejects(clean.q(`INSERT INTO owner_statements (owner_id, property_id, month) VALUES (1, $1, '2026-09')`, [clean.p]), /duplicate key/);
  const dirty = await run(true);
  assert.ok(!dirty.idxRows.includes('owner_statements_property_month_unique'), 'no unique index while duplicates exist');
  assert.equal(dirty.count, 3, 'duplicates are kept, not deleted');
  console.log('PASS: 0012 adds one-statement-per-property-month only on clean data; duplicates kept and reported');
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await rm(before, { recursive: true, force: true }); }
