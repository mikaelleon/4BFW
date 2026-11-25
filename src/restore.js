// Imported BEFORE db.js (see index.js). On hosts with a wiped disk (Render free tier) the database file is gone on
// every restart: pull the newest encrypted backup from the backup channel and put it back before the DB opens.
import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { BACKUP_PREFIX, BACKUP_SUFFIX, backupEnabled, decryptDb } from './lib/backup-crypto.js';

const DB_PATH = 'data/confessions.db';
const API = 'https://discord.com/api/v10';

async function restore() {
  if (existsSync(DB_PATH) || !backupEnabled() || !process.env.DISCORD_TOKEN) return;
  const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };

  const res = await fetch(`${API}/channels/${process.env.BACKUP_CHANNEL_ID}/messages?limit=50`, { headers });
  if (!res.ok) throw new Error(`listing backup channel failed (${res.status})`);
  const messages = await res.json(); // newest first
  const file = messages
    .flatMap((m) => m.attachments ?? [])
    .find((a) => a.filename.startsWith(BACKUP_PREFIX) && a.filename.endsWith(BACKUP_SUFFIX));
  if (!file) return console.log('Backup restore: no backup found, starting with an empty database.');

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
  // Wrong passphrase, missing channel access, etc. Start empty rather than crash-loop, but say so loudly.
  console.error('Backup restore FAILED, starting with an empty database:', err.message);
}
