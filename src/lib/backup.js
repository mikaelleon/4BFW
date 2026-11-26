// Periodic encrypted database backup to a private Discord channel (BACKUP_CHANNEL_ID). Restore is in ../restore.js.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AttachmentBuilder } from 'discord.js';
import * as db from '../db.js';
import { restoreFailed, restored } from '../restore.js';
import { BACKUP_PREFIX, BACKUP_SUFFIX, backupEnabled, encryptDb } from './backup-crypto.js';

const INTERVAL_MS = 15 * 60_000;
const KEEP = 10; // newest backups kept in the channel
const WRITE_DEBOUNCE_MS = 20_000; // backup this long after the last change
const MAX_BYTES = 9 * 1024 * 1024; // stay under Discord's default upload limit

let lastHash = null;
let queue = Promise.resolve();
let lastAlert = null;

/**
 * Upload a backup if the data changed since the last one. `force` skips the change check. Runs one at a time.
 * Returns { messageId, dropped } after an upload (`dropped` = images left out to fit), or null when there was nothing
 * to do (backups off, or no change). Throws when a backup was needed but could not be uploaded.
 */
export function runBackup(client, options) {
  const next = queue.catch(() => {}).then(() => backupOnce(client, options));
  queue = next;
  return next;
}

/**
 * Encrypt the snapshot at `path`, leaving images out of that copy (never the live database) until it fits the upload
 * limit. Images of deleted and rejected posts go first, then live posts (oldest first), then ones awaiting a moderator.
 */
function fitToLimit(path, raw) {
  let enc = encryptDb(raw);
  let dropped = 0;
  if (enc.length <= MAX_BYTES) return { enc, dropped };

  const snap = new DatabaseSync(path);
  try {
    const images = snap
      .prepare(
        `SELECT i.confession_id AS id, length(i.data) AS size
           FROM confession_images i LEFT JOIN confessions c ON c.id = i.confession_id
          ORDER BY CASE WHEN c.id IS NULL OR c.status IN ('deleted', 'rejected') THEN 0 WHEN c.status = 'posted' THEN 1 ELSE 2 END,
                   i.confession_id`,
      )
      .all();
    const remove = snap.prepare('DELETE FROM confession_images WHERE confession_id = ?');
    while (enc.length > MAX_BYTES && dropped < images.length) {
      let excess = enc.length - MAX_BYTES;
      while (excess > 0 && dropped < images.length) {
        remove.run(images[dropped].id);
        excess -= images[dropped].size;
        dropped++;
      }
      snap.exec('VACUUM');
      enc = encryptDb(readFileSync(path));
    }
  } finally {
    snap.close();
  }
  if (enc.length > MAX_BYTES) throw new Error('the database is over the upload limit even without images');
  return { enc, dropped };
}

async function backupOnce(client, { force = false } = {}) {
  if (!backupEnabled()) return null;
  if (restoreFailed) throw new Error('the startup restore failed, so this database is not trustworthy');
  const dir = mkdtempSync(join(tmpdir(), 'confbak-'));
  try {
    const snap = join(dir, 'snap.db');
    db.snapshotTo(snap);
    const raw = readFileSync(snap);
    const hash = createHash('sha256').update(raw).digest('hex');
    if (!force && hash === lastHash) return null;

    const { enc, dropped } = fitToLimit(snap, raw);
    const channel = await client.channels.fetch(process.env.BACKUP_CHANNEL_ID);
    const name = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}${BACKUP_SUFFIX}`;
    const note = dropped ? `\n⚠️ ${dropped} stored image(s) left out to fit the upload limit. All records are included.` : '';
    const sent = await channel.send({ content: `DB backup (encrypted)${note}`, files: [new AttachmentBuilder(enc, { name })] });
    lastHash = hash;
    lastAlert = null;

    // Trim old backups (the bot can always delete its own messages). The upload already worked, so a failure here is fine.
    try {
      const mine = [...(await channel.messages.fetch({ limit: 50 })).values()]
        .filter((m) => m.author.id === client.user.id && m.attachments.some((a) => a.name.startsWith(BACKUP_PREFIX)));
      for (const old of mine.slice(KEEP)) await old.delete().catch(() => {});
    } catch (err) {
      console.error('Could not trim old backups:', err.message);
    }
    return { messageId: sent.id, dropped };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Log a failed backup and say so in the backup channel, once per distinct problem until a backup succeeds again. */
async function reportFailure(client, err) {
  console.error('Backup failed:', err);
  const reason = String(err?.message ?? err);
  if (reason === lastAlert) return;
  try {
    const channel = await client.channels.fetch(process.env.BACKUP_CHANNEL_ID);
    await channel.send({ content: `⚠️ **Backup failed:** ${reason.slice(0, 1500)}. New data is not being backed up.`, allowedMentions: { parse: [] } });
    lastAlert = reason;
  } catch (sendErr) {
    console.error('Could not post the backup alert:', sendErr.message);
  }
}

export function startBackups(client) {
  if (!backupEnabled()) return console.log('Backups off: set BACKUP_CHANNEL_ID and BACKUP_PASSPHRASE to enable.');
  const tick = () => runBackup(client).catch((err) => reportFailure(client, err));

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
