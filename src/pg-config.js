// Connection settings shared by the bot and the migration scripts.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// count(), sum() and bigint columns come back as strings by default. Every number the bot stores (ids, counts,
// millisecond timestamps) is far below 2^53, so plain numbers are safe.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function pgConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set. See docs/supabase.md.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    // Do not echo the value: it holds the database password.
    throw new Error('DATABASE_URL is not a valid address. Special characters in the password must be percent-encoded.');
  }
  url.searchParams.delete('sslmode'); // it would override the certificate check below

  let ssl = false;
  if (!LOCAL_HOSTS.has(url.hostname)) {
    const ca = process.env.DATABASE_CA_CERT;
    if (!ca) throw new Error('DATABASE_CA_CERT is not set: point it to the certificate downloaded from Supabase. See docs/supabase.md.');
    ssl = { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true };
  }
  return { connectionString: url.toString(), ssl };
}

export default pg;
