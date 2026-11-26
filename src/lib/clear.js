// Bulk-delete helpers for /cleardms and /clearchannels. Both only ever delete messages written by this bot.
import { MessageFlags, PermissionFlagsBits } from 'discord.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BULK_MAX_AGE = 14 * 86_400_000 - 60_000; // Discord refuses bulk deletes of messages older than 14 days
const MAX_PAGES = 200; // 100 messages per page: stops a runaway scan

const running = new Set();
/** One clear at a time per server, so two admins cannot overlap. */
export const isClearing = (guildId) => running.has(guildId);
export async function withClearLock(guildId, fn) {
  running.add(guildId);
  try {
    return await fn();
  } finally {
    running.delete(guildId);
  }
}

/**
 * Show a finished job's result as a dismissable (ephemeral) message where the command was used.
 * Discord only allows that for 15 minutes after the command, so a longer job falls back to a DM.
 */
export async function reportResult(interaction, content) {
  try {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } catch {
    await interaction.user.send(content).catch((err) => console.error('Could not deliver a clear result:', err.message));
  }
}

/** Delete every message this bot sent in its DM with `user`. Returns how many were deleted. */
export async function clearDmsWith(client, user) {
  const dm = await user.createDM();
  let deleted = 0;
  let before;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await dm.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    before = batch.last().id; // newest first, so last() is the oldest
    for (const m of batch.values()) {
      if (m.author.id !== client.user.id) continue;
      if (await m.delete().then(() => true, () => false)) deleted++;
      await sleep(250);
    }
    if (batch.size < 100) break;
  }
  return deleted;
}

/**
 * Delete every message this bot sent in `channel`, except `keepId` (the sticky). With `before` (a message id) only older
 * messages are touched. Returns how many were deleted.
 */
export async function clearBotMessages(channel, { keepId, before } = {}) {
  const me = channel.client.user.id;
  const canBulk = Boolean(channel.permissionsFor(channel.guild.members.me)?.has(PermissionFlagsBits.ManageMessages));
  let deleted = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    before = batch.last().id;
    let mine = batch.filter((m) => m.author.id === me && m.id !== keepId);

    if (canBulk) {
      const recent = mine.filter((m) => Date.now() - m.createdTimestamp < BULK_MAX_AGE);
      if (recent.size > 1) {
        const gone = await channel.bulkDelete(recent, true).catch(() => null);
        if (gone) {
          deleted += gone.size;
          mine = mine.filter((m) => !gone.has(m.id));
        }
      }
    }
    for (const m of mine.values()) {
      if (await m.delete().then(() => true, () => false)) deleted++;
      await sleep(300);
    }
    if (batch.size < 100) break;
  }
  return deleted;
}
