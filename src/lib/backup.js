// Periodic encrypted database backup to a private Discord channel (BACKUP_CHANNEL_ID). Restore is in ../restore.js.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import * as db from '../db.js';
import { BACKUP_PREFIX, BACKUP_SUFFIX, backupEnabled, encryptDb } from './backup-crypto.js';

const INTERVAL_MS = 15 * 60_000;
const KEEP = 5; // newest backups kept in the channel
const MAX_BYTES = 9 * 1024 * 1024; // stay under Discord's default upload limit

let lastHash = null;
let running = false;

/** Upload a backup if the data changed since the last one. `force` skips the change check. */
export async function runBackup(client, { force = false } = {}) {
  if (!backupEnabled() || running) return;
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
  tick();
  setInterval(tick, INTERVAL_MS).unref();

  // Render sends SIGTERM before a restart/redeploy: take a last backup first.
  process.once('SIGTERM', async () => {
    await Promise.race([runBackup(client).catch(() => {}), new Promise((r) => setTimeout(r, 15_000))]);
    process.exit(0);
  });
}
