// Migration 0011 check: every property ends up with one fee record holding the values that were in
// effect before (management % from the old fee record or the property, cleaning fee from the property).
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
const idx = journal.entries.findIndex(e => e.tag.startsWith('0011_'));
assert.ok(idx > 0, '0011 migration is in the journal');
const before = await mkdtemp(path.join(tmpdir(), 'yallapms-mig-'));
await cp(full, before, { recursive: true });
await writeFile(path.join(before, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, idx) }));
const client = new PGlite();
const db = drizzle(client);
try {
  await migrate(db, { migrationsFolder: before });
  const ins = async (name, city, mgmt, clean) => (await client.query(
    `INSERT INTO properties (name, unit_number, city, management_fee, cleaning_fee) VALUES ($1, $1, $2, $3, $4) RETURNING id`, [name, city, mgmt, clean])).rows[0].id;
  const a = await ins('Dubai no record', 'Dubai', '25', '200');
  const b = await ins('Abu Dhabi no record', 'Abu Dhabi', null, '1,250.50');
  const c = await ins('Has record', 'Dubai', '30', '180');
  const d = await ins('Messy text', null, '15%', 'AED 99');
  await client.query(`INSERT INTO property_settings (property_id, management_fee_percent, tourism_enabled, vat_enabled) VALUES ($1, 18, false, true)`, [c]);
  await migrate(db, { migrationsFolder: full });
  const rows = Object.fromEntries((await client.query(`SELECT property_id, management_fee_percent::float AS m, cleaning_fee::float AS cf, tourism_enabled AS t, vat_enabled AS v, currency FROM property_settings`)).rows.map(r => [r.property_id, r]));
  assert.equal(Object.keys(rows).length, 4, 'one fee record per property');
  assert.deepEqual([rows[a].m, rows[a].cf, rows[a].t, rows[a].v, rows[a].currency], [25, 200, true, true, 'AED']);
  assert.deepEqual([rows[b].m, rows[b].cf, rows[b].t, rows[b].v], [20, 1250.5, false, false]);
  assert.deepEqual([rows[c].m, rows[c].cf, rows[c].t, rows[c].v], [18, 180, false, true], 'existing record keeps its values and gains the cleaning fee');
  assert.deepEqual([rows[d].m, rows[d].cf], [15, null]);
  const legacy = (await client.query(`SELECT legacy_management_fee, legacy_cleaning_fee FROM properties WHERE id = $1`, [a])).rows[0];
  assert.deepEqual(legacy, { legacy_management_fee: '25', legacy_cleaning_fee: '200' }, 'old values kept for reference');
  console.log('PASS: 0011 moves management % and cleaning fee into fee settings, preserving effective values');
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await client.close(); await rm(before, { recursive: true, force: true }); }
