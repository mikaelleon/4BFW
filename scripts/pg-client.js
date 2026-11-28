// One Postgres connection for the migration scripts.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export async function connect() {
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

  const client = new pg.Client({ connectionString: url.toString(), ssl });
  await client.connect();
  return client;
}
