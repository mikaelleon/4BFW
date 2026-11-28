// Applies every file in supabase/migrations that has not run yet, in name order. `--status` only lists them.
import { readFileSync, readdirSync } from 'node:fs';
import { connect } from './pg-client.js';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const statusOnly = process.argv.includes('--status');

const client = await connect().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

try {
  await client.query('SELECT pg_advisory_lock(727274)'); // one migration run at a time
  const known = await client.query("SELECT to_regclass('public.schema_migrations') AS t");
  const done = new Set(known.rows[0].t ? (await client.query('SELECT name FROM public.schema_migrations')).rows.map((r) => r.name) : []);
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (statusOnly) {
    for (const file of files) console.log(`${done.has(file) ? 'applied' : 'pending'}  ${file}`);
  } else {
    await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query('ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY');
    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(new URL(file, DIR), 'utf8'));
        await client.query('INSERT INTO public.schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${file} failed, nothing from it was kept: ${err.message}`);
      }
      console.log(`applied  ${file}`);
      applied++;
    }
    console.log(applied ? `Done: ${applied} migration(s) applied.` : 'Nothing to apply: the database is up to date.');
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
