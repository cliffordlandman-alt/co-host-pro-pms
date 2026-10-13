// Copy the Mac's embedded database (PGlite, .local-data/postgres) into a real Postgres (DATABASE_URL).
// Read-only on the source. The target must be a fresh database (no users): the script runs the app's migrations there first, then copies
// every table row-for-row in one transaction, resets id sequences, and compares row counts. Prints counts only, never data.
//   SOURCE_DIR=/path/to/.local-data DATABASE_URL=postgres://... MIGRATIONS_DIR=./drizzle node pglite-to-postgres.mjs
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';

const src = process.env.SOURCE_DIR, url = process.env.DATABASE_URL, migrations = path.resolve(process.env.MIGRATIONS_DIR || 'drizzle');
if (!src || !url) { console.error('Set SOURCE_DIR (the .local-data folder) and DATABASE_URL'); process.exit(2); }
const from = new PGlite(path.resolve(src, 'postgres'));
const pool = new pg.Pool({ connectionString: url });
const q = (sql, p) => pool.query(sql, p);
const tablesOf = async run => (await run(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`)).rows.map(r => r.table_name);

const existing = await tablesOf(q);
// A used target has people in it; migrations alone only add reference rows (those are replaced by the copy).
if (existing.includes('users') && Number((await q('select count(*)::int n from users')).rows[0].n) > 0) { console.error('Target already has users: it is in use. Stopping; nothing changed.'); process.exit(3); }
await migrate(drizzle(pool), { migrationsFolder: migrations });
const srcTables = await tablesOf((s, p) => from.query(s, p)), dstTables = new Set(await tablesOf(q));
const missing = srcTables.filter(t => !dstTables.has(t)); if (missing.length) { console.error(`Tables missing in target after migrations: ${missing.join(', ')}`); process.exit(4); }

const client = await pool.connect(); const report = [];
try {
  await client.query('begin');
  await client.query("set session_replication_role = replica"); // skip FK checks while loading in any order
  await client.query(`truncate ${srcTables.map(t => `"${t}"`).join(', ')}`); // drop rows the migrations seeded
  for (const t of srcTables) {
    const cols = (await from.query(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1 and is_generated='NEVER' order by ordinal_position`, [t])).rows;
    const names = cols.map(c => `"${c.column_name}"`).join(',');
    const rows = (await from.query(`select ${names} from "${t}"`)).rows;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200), vals = [], ph = chunk.map((r, ri) => `(${cols.map((c, ci) => { const v = r[c.column_name]; vals.push(v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) && !Array.isArray(v) ? JSON.stringify(v) : (Array.isArray(v) && /json/.test(c.data_type) ? JSON.stringify(v) : v)); return `$${ri * cols.length + ci + 1}`; }).join(',')})`);
      await client.query(`insert into "${t}" (${names}) values ${ph.join(',')}`, vals);
    }
    report.push([t, rows.length]);
  }
  for (const s of (await client.query(`select t.relname tbl, a.attname col, pg_get_serial_sequence(quote_ident(t.relname), a.attname) seq from pg_class t join pg_attribute a on a.attrelid=t.oid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and t.relkind='r' and a.attnum>0 and pg_get_serial_sequence(quote_ident(t.relname), a.attname) is not null`)).rows)
    await client.query(`select setval($1, coalesce((select max("${s.col}") from "${s.tbl}"), 0) + 1, false)`, [s.seq]);
  await client.query("set session_replication_role = origin");
  for (const [t, n] of report) { const m = Number((await client.query(`select count(*)::int n from "${t}"`)).rows[0].n); if (m !== n) throw new Error(`${t}: copied ${m} of ${n}`); }
  await client.query('commit');
} catch (e) { await client.query('rollback'); console.error('Failed, target rolled back:', e.message); process.exit(5); } finally { client.release(); }
for (const [t, n] of report) console.log(`${t.padEnd(36)} ${n}`);
console.log(`OK: ${report.length} tables, ${report.reduce((a, [, n]) => a + n, 0)} rows copied; counts match.`);
await pool.end(); await from.close();
