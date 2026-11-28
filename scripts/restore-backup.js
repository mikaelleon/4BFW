// Puts a backup into an empty, migrated Postgres database, in one transaction.
//   npm run db:restore                        the newest backup in BACKUP_CHANNEL_ID
//   npm run db:restore -- --file <path>       a downloaded backup file
//   add --dry-run to check it and keep nothing
// Needs the same BACKUP_PASSPHRASE the backup was made with.
import { readFileSync } from 'node:fs';
import { PG_BACKUP_PREFIX, PG_BACKUP_SUFFIX, decryptDb } from '../src/lib/backup-crypto.js';
import { loadSnapshot } from '../src/lib/snapshot.js';
import { connect } from './pg-client.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const at = args.indexOf('--file');

const stop = (message) => {
  console.error(message);
  process.exit(1);
};

async function download() {
  const { DISCORD_TOKEN, BACKUP_CHANNEL_ID } = process.env;
  if (!DISCORD_TOKEN || !BACKUP_CHANNEL_ID) stop('Set DISCORD_TOKEN and BACKUP_CHANNEL_ID, or pass --file.');
  const res = await fetch(`https://discord.com/api/v10/channels/${BACKUP_CHANNEL_ID}/messages?limit=50`, {
    headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
  });
  if (!res.ok) stop(`Listing the backup channel failed (${res.status}).`);
  const file = (await res.json()) // newest first
    .flatMap((m) => m.attachments ?? [])
    .find((a) => a.filename.startsWith(PG_BACKUP_PREFIX) && a.filename.endsWith(PG_BACKUP_SUFFIX));
  if (!file) stop('No backup found in the channel.');
  const data = await fetch(file.url);
  if (!data.ok) stop(`Downloading ${file.filename} failed (${data.status}).`);
  console.log(`Using ${file.filename}`);
  return Buffer.from(await data.arrayBuffer());
}

if (!process.env.BACKUP_PASSPHRASE) stop('Set BACKUP_PASSPHRASE.');
if (at !== -1 && !args[at + 1]) stop('Give a file after --file.');
const encrypted = at === -1 ? await download() : readFileSync(args[at + 1]);
let json;
try {
  json = decryptDb(encrypted).toString('utf8');
} catch {
  stop('Could not decrypt the backup: wrong BACKUP_PASSPHRASE, or the file is damaged.');
}

const client = await connect().catch((err) => stop(err.message));
try {
  await client.query('BEGIN');
  // A freshly started bot writes this one row itself; the backup brings its own.
  await client.query("DELETE FROM public.meta WHERE key = 'idkey_fp'");
  // A dry run rolls back, but sequence changes would stay: skip them.
  const query = (sql, values) => (dryRun && sql.startsWith('SELECT setval') ? Promise.resolve({ rows: [] }) : client.query(sql, values));
  const counts = await loadSnapshot(query, json);
  for (const [table, n] of Object.entries(counts)) console.log(`${String(n).padStart(8)}  ${table}`);
  await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  console.log(dryRun ? 'Dry run passed. Nothing was kept.' : 'Restore complete.');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Restore failed, nothing was changed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
