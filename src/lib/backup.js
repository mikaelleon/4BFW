// Daily encrypted database backup to a private Discord channel (BACKUP_CHANNEL_ID). The free Supabase plan keeps none.
// To put one back: `npm run db:restore` (see docs/supabase.md).
import { AttachmentBuilder } from 'discord.js';
import { readSnapshot } from '../db.js';
import { PG_BACKUP_PREFIX, PG_BACKUP_SUFFIX, backupEnabled, encryptDb } from './backup-crypto.js';
import { takeSnapshot } from './snapshot.js';

const EVERY_MS = 24 * 60 * 60_000;
const CHECK_MS = 60 * 60_000;
const KEEP = 10; // newest backups kept in the channel
const MAX_BYTES = 9 * 1024 * 1024; // stay under Discord's default upload limit

let queue = Promise.resolve();
let lastAlert = null;

/**
 * Upload a backup now. Runs one at a time. Returns { messageId, dropped } (`dropped` = images left out to fit), or null
 * when backups are off. Throws when the backup could not be made or uploaded.
 */
export function runBackup(client) {
  const next = queue.catch(() => {}).then(() => backupOnce(client));
  queue = next;
  return next;
}

/** Snapshot and encrypt, fetching fewer images until the file fits the upload limit. */
async function packed() {
  for (let budget = MAX_BYTES; ; budget = budget > 64 * 1024 ? Math.floor(budget / 2) : 0) {
    const { json, dropped } = await readSnapshot((query) => takeSnapshot(query, budget));
    const enc = encryptDb(Buffer.from(json));
    if (enc.length <= MAX_BYTES) return { enc, dropped };
    if (budget === 0) throw new Error('the database is over the upload limit even without images');
  }
}

const ownBackups = async (client, channel) =>
  [...(await channel.messages.fetch({ limit: 50 })).values()]
    .filter((m) => m.author.id === client.user.id && m.attachments.some((a) => a.name.startsWith(PG_BACKUP_PREFIX)))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

async function backupOnce(client) {
  if (!backupEnabled()) return null;
  const { enc, dropped } = await packed();
  const channel = await client.channels.fetch(process.env.BACKUP_CHANNEL_ID);
  const name = `${PG_BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}${PG_BACKUP_SUFFIX}`;
  const note = dropped ? `\n⚠️ ${dropped} stored image(s) left out to fit the upload limit. All records are included.` : '';
  const sent = await channel.send({ content: `DB backup (encrypted)${note}`, files: [new AttachmentBuilder(enc, { name })] });
  lastAlert = null;

  // Trim old backups (the bot can always delete its own messages). The upload already worked, so a failure here is fine.
  try {
    for (const old of (await ownBackups(client, channel)).slice(KEEP)) await old.delete().catch(() => {});
  } catch (err) {
    console.error('Could not trim old backups:', err.message);
  }
  return { messageId: sent.id, dropped };
}

/** Back up only if the newest one in the channel is a day old, so restarts do not pile them up. */
async function backupIfDue(client) {
  const channel = await client.channels.fetch(process.env.BACKUP_CHANNEL_ID);
  const [newest] = await ownBackups(client, channel);
  if (!newest || Date.now() - newest.createdTimestamp >= EVERY_MS) await runBackup(client);
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
  const tick = () => backupIfDue(client).catch((err) => reportFailure(client, err));
  tick();
  setInterval(tick, CHECK_MS).unref();
}
