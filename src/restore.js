// `npm run db:pull`, for the one-time move to Postgres: downloads the newest SQLite backup from the backup channel to
// data/confessions.db (only if no file is there), ready for `npm run db:copy`. The bot itself does not use this.
import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { BACKUP_PREFIX, BACKUP_SUFFIX, backupEnabled, decryptDb } from './lib/backup-crypto.js';

const DB_PATH = 'data/confessions.db';
const API = 'https://discord.com/api/v10';

async function restore() {
  if (existsSync(DB_PATH)) return console.log(`${DB_PATH} already exists: nothing downloaded.`);
  if (!backupEnabled() || !process.env.DISCORD_TOKEN) {
    throw new Error('set DISCORD_TOKEN, BACKUP_CHANNEL_ID and BACKUP_PASSPHRASE');
  }
  const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const res = await fetch(`${API}/channels/${process.env.BACKUP_CHANNEL_ID}/messages?limit=50`, { headers });
  if (!res.ok) throw new Error(`listing backup channel failed (${res.status})`);
  const messages = await res.json(); // newest first
  const file = messages
    .flatMap((m) => m.attachments ?? [])
    .find((a) => a.filename.startsWith(BACKUP_PREFIX) && a.filename.endsWith(BACKUP_SUFFIX));
  if (!file) throw new Error('no SQLite backup found in the channel');

  const data = await fetch(file.url);
  if (!data.ok) throw new Error(`downloading ${file.filename} failed (${data.status})`);
  const db = decryptDb(Buffer.from(await data.arrayBuffer()));
  mkdirSync('data', { recursive: true });
  writeFileSync(DB_PATH, db);
  console.log(`Backup restore: restored ${file.filename} (${db.length} bytes).`);
}

try {
  await restore();
} catch (err) {
  console.error('Download failed:', err.message);
  process.exitCode = 1;
}
