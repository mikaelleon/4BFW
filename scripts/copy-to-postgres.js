// Copies the SQLite database into an empty, migrated Postgres database, in one transaction.
//   npm run db:copy -- --dry-run          copy, check, then undo
//   npm run db:copy                       copy for real
//   npm run db:copy -- --sqlite <file>    read another file (default data/confessions.db)
// The SQLite file is opened read-only.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { TABLES, WITH_IDENTITY } from '../src/lib/tables.js';
import { connect } from './pg-client.js';

const SCHEMA_VERSION = 16; // the last SQLite schema the bot had

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const at = args.indexOf('--sqlite');
const path = at === -1 ? 'data/confessions.db' : args[at + 1];

const stop = (message) => {
  console.error(message);
  process.exit(1);
};

if (!path || !existsSync(path)) stop(`No SQLite database at ${path ?? '(no file given)'}. See docs/supabase.md.`);
const source = new DatabaseSync(path, { readOnly: true });
const version = source.prepare('PRAGMA user_version').get().user_version;
if (version !== SCHEMA_VERSION) {
  stop(`The SQLite file has schema version ${version}; version ${SCHEMA_VERSION} is expected. A new schema needs a new Postgres migration first.`);
}
const unknown = source
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((r) => r.name)
  .filter((name) => !TABLES.includes(name));
if (unknown.length) stop(`The SQLite file has tables this script does not copy: ${unknown.join(', ')}.`);

/** node:sqlite returns blobs as Uint8Array; node-postgres wants a Buffer. */
const toPostgres = (value) => (value instanceof Uint8Array ? Buffer.from(value) : value);

async function copyTable(client, table) {
  const columns = source.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const names = columns.map((c) => `"${c}"`).join(', ');
  const batchSize = table === 'confession_images' ? 5 : 200;
  let batch = [];
  let count = 0;

  const flush = async () => {
    if (!batch.length) return;
    const rows = batch.map((_, r) => `(${columns.map((__, c) => `$${r * columns.length + c + 1}`).join(', ')})`);
    await client.query(`INSERT INTO public.${table} (${names}) VALUES ${rows.join(', ')}`, batch.flat());
    count += batch.length;
    batch = [];
  };

  for (const row of source.prepare(`SELECT ${names} FROM ${table}`).iterate()) {
    batch.push(columns.map((c) => toPostgres(row[c])));
    if (batch.length >= batchSize) await flush();
  }
  await flush();

  const stored = Number((await client.query(`SELECT count(*) AS n FROM public.${table}`)).rows[0].n);
  if (stored !== count) throw new Error(`${table}: sent ${count} rows but Postgres holds ${stored}`);
  console.log(`${String(count).padStart(8)}  ${table}`);
}

const client = await connect().catch((err) => stop(err.message));
try {
  source.exec('BEGIN'); // one consistent view, even if the bot is writing
  await client.query('BEGIN');
  // A bot started against the new database writes this one row itself; the copy brings its own.
  await client.query("DELETE FROM public.meta WHERE key = 'idkey_fp'");

  for (const table of TABLES) {
    const { rows } = await client.query(`SELECT 1 FROM public.${table} LIMIT 1`);
    if (rows.length) throw new Error(`${table} in Postgres already has data. This script only fills an empty database.`);
  }
  for (const table of TABLES) await copyTable(client, table);

  // A sequence change is not undone by ROLLBACK, so a dry run leaves the sequences alone.
  if (!dryRun) {
    // New ids continue after the highest id SQLite ever handed out, so deleted ids are never reused.
    for (const table of WITH_IDENTITY) {
      const used = source.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table)?.seq ?? 0;
      const max = source.prepare(`SELECT COALESCE(MAX(id), 0) AS n FROM ${table}`).get().n;
      const last = Math.max(used, max);
      if (last > 0) await client.query("SELECT setval(pg_get_serial_sequence($1, 'id'), $2, true)", [`public.${table}`, last]);
    }
  }

  await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  console.log(dryRun ? 'Dry run passed. Nothing was kept in Postgres.' : 'Copy complete.');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Copy failed, nothing was kept: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
  source.close();
}
