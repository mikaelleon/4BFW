// Periodic encrypted database backup to a private Discord channel (BACKUP_CHANNEL_ID). Restore is in ../restore.js.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import * as db from '../db.js';
import { restoreFailed, restored } from '../restore.js';
import { BACKUP_PREFIX, BACKUP_SUFFIX, backupEnabled, encryptDb } from './backup-crypto.js';

const INTERVAL_MS = 15 * 60_000;
const KEEP = 10; // newest backups kept in the channel
const WRITE_DEBOUNCE_MS = 20_000; // backup this long after the last change
const MAX_BYTES = 9 * 1024 * 1024; // stay under Discord's default upload limit

let lastHash = null;
let running = false;

/** Upload a backup if the data changed since the last one. `force` skips the change check. */
export async function runBackup(client, { force = false } = {}) {
  if (!backupEnabled() || running) return;
  if (restoreFailed) return console.error('Backup skipped: the startup restore failed, so this database is not trustworthy.');
  running = true;
  const dir = mkdtempSync(join(tmpdir(), 'confbak-'));
  try {
    const snap = join(dir, 'snap.db');
    db.snapshotTo(snap);
    const raw = readFileSync(snap);
    const hash = createHash('sha256').update(raw).digest('hex');
    if (!force && hash === lastHash) return;

    const enc = encryptDb(raw);
    if (enc.length > MAX_BYTES) return console.error(`Backup skipped: ${enc.length} bytes is over the upload limit.`);

    const channel = await client.channels.fetch(process.env.BACKUP_CHANNEL_ID);
    const name = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}${BACKUP_SUFFIX}`;
    await channel.send({ content: 'DB backup (encrypted)', files: [new AttachmentBuilder(enc, { name })] });
    lastHash = hash;

    // Trim old backups (the bot can always delete its own messages).
    const mine = [...(await channel.messages.fetch({ limit: 50 })).values()]
      .filter((m) => m.author.id === client.user.id && m.attachments.some((a) => a.name.startsWith(BACKUP_PREFIX)));
    for (const old of mine.slice(KEEP)) await old.delete().catch(() => {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
    running = false;
  }
}

export function startBackups(client) {
  if (!backupEnabled()) return console.log('Backups off: set BACKUP_CHANNEL_ID and BACKUP_PASSPHRASE to enable.');
  const tick = () => runBackup(client).catch((err) => console.error('Backup failed:', err));

  if (restored) {
    // The DB is exactly what the newest backup holds: remember that instead of uploading a duplicate (which would
    // also land after another instance's final backup and hide it).
    const dir = mkdtempSync(join(tmpdir(), 'confbak-'));
    try {
      db.snapshotTo(join(dir, 'snap.db'));
      lastHash = createHash('sha256').update(readFileSync(join(dir, 'snap.db'))).digest('hex');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    tick();
  }
  setInterval(tick, INTERVAL_MS).unref();

  // Back up shortly after any change, so a deploy loses seconds of data, not up to 15 minutes.
  let timer = null;
  db.onWrite(() => {
    clearTimeout(timer);
    timer = setTimeout(tick, WRITE_DEBOUNCE_MS);
    timer.unref();
  });

  // Render sends SIGTERM before a restart/redeploy: take a last backup first.
  process.once('SIGTERM', async () => {
    await Promise.race([runBackup(client).catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
    process.exit(0);
  });
}
