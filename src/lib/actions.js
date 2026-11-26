// Moderation actions shared by the /mod slash commands and the buttons under each mod-log entry.
import * as db from '../db.js';
import { deleteConfessionMessage, restoreConfessionMessage } from './confession.js';
import { untilTag } from './duration.js';
import { anonRef, anonTitle } from './format.js';
import { dmUser, modLog, notice } from './moderation.js';
import { banNotice, deletionNotice, warningCode, warningNotice } from './notices.js';

const label = (row) => `ID \`${row.sub_id}\` (${row.number ? `public ${anonRef(row.number)}` : 'not posted yet'})`;
const isLive = (row) => row.status !== 'deleted' && row.channel_id && row.message_id; // hidden posts still have a message

/** Fields every log entry carries: the submission's text, sender and (while it exists) jump link. */
function logBase(guild, row, actor, { gone = false } = {}) {
  return {
    id: row.id,
    subId: row.sub_id,
    number: row.number,
    actor,
    content: row.content,
    hasImage: Boolean(row.has_image),
    authorId: row.author_id,
    url: !gone && isLive(row) ? `https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id}` : null,
  };
}

export async function deleteSubmission(guild, row, actor, reason) {
  const alreadyGone = row.status === 'deleted';
  await deleteConfessionMessage(guild, row);
  if (!alreadyGone) await dmUser(guild.client, row.author_id, deletionNotice(guild, row, { reason }));
  await modLog(guild, { ...logBase(guild, row, actor, { gone: true }), title: 'Submission deleted', reason });
  return `Submission ${label(row)} deleted.`;
}

export async function warnAuthor(client, guild, row, actor, reason, { alsoDelete = false } = {}) {
  const cfg = db.getGuild(guild.id);
  const limit = cfg.warn_limit;
  const warningId = db.addWarning(guild.id, row.author_key, row.id, reason);
  const count = db.countWarnings(guild.id, row.author_key);
  if (alsoDelete) await deleteConfessionMessage(guild, row);
  const base = logBase(guild, row, actor, { gone: alsoDelete });

  // Reaching the limit bans the author; the warning DM then carries the restriction notice (one message, not two).
  const autoBan = count >= limit && !db.getBan(guild.id, row.author_key);
  if (autoBan) db.banUser(guild.id, row.author_key, `Reached ${limit} warnings`, actor.id, null);

  const dmed = await dmUser(
    client,
    row.author_id,
    warningNotice(guild, row, {
      reason,
      warningId,
      count,
      limit,
      expiryDays: cfg.warn_expiry_days,
      banned: autoBan,
      deleted: alsoDelete,
    }),
  );
  await modLog(guild, {
    ...base,
    title: `Author warned (${count}/${limit})`,
    reason,
    fields: [{ name: 'Warning ID', value: warningCode(warningId), inline: true }],
  });

  let out = `Warned the author of ${label(row)} (${count}/${limit}, ${warningCode(warningId)}). ${dmed ? 'They were notified.' : 'Their DMs are closed, so they were not notified.'}`;
  if (autoBan) {
    await modLog(guild, { ...base, title: 'Author auto-banned (warn limit)', reason: `Reached ${limit} warnings` });
    out += '\nWarn limit reached: the author is now **banned** from posting.';
  }
  return out;
}

/** `durationMs` = timed ban (lifts itself), null = permanent. */
export async function banAuthor(client, guild, row, actor, reason, { alsoDelete = true, durationMs = null } = {}) {
  const already = db.getBan(guild.id, row.author_key);
  const expiresAt = durationMs ? Date.now() + durationMs : null;
  db.banUser(guild.id, row.author_key, reason ?? 'No reason given', actor.id, expiresAt, row.author_id);
  const lasts = expiresAt ? `until ${untilTag(expiresAt)}` : 'permanently';
  if (alsoDelete) await deleteConfessionMessage(guild, row);
  await dmUser(client, row.author_id, banNotice(guild, row, { reason, until: expiresAt ? untilTag(expiresAt) : null, deleted: alsoDelete }));
  await modLog(guild, {
    ...logBase(guild, row, actor, { gone: alsoDelete }),
    title: expiresAt ? 'Author banned (timed)' : 'Author banned',
    reason,
    fields: [{ name: 'Length', value: expiresAt ? `Until ${untilTag(expiresAt)}` : 'Permanent', inline: true }],
  });
  return already
    ? `That author was already banned. The ban was updated (${lasts}).`
    : `Author of ${label(row)} is banned from posting ${lasts}.`;
}

export async function unbanAuthor(client, guild, row, actor, { clearWarnings = true } = {}) {
  if (!db.unbanUser(guild.id, row.author_key)) return 'That author is not banned.';
  if (clearWarnings) db.clearWarnings(guild.id, row.author_key);
  const reset = clearWarnings ? ' Your warnings were cleared too.' : '';
  await dmUser(client, row.author_id, notice(`Ban lifted in ${guild.name}`, `A moderator lifted your posting ban. You can post again.${reset} Please follow the rules.`));
  await modLog(guild, { ...logBase(guild, row, actor), title: 'Author unbanned' });
  return `Author of ${label(row)} can post again.`;
}

/** Put an auto-hidden post back and dismiss its reports. */
export async function restoreSubmission(guild, row, actor) {
  if (row.status !== 'hidden') return 'That submission is not hidden.';
  const ok = await restoreConfessionMessage(guild, row).catch((err) => {
    console.error('Restore failed:', err);
    return false;
  });
  if (!ok) return 'I could not restore it: the original message is gone or I cannot edit it. Delete it instead.';
  await dmUser(
    guild.client,
    row.author_id,
    notice(
      `Reports lifted in ${guild.name}`,
      `A moderator reviewed the reports on your **${anonTitle(row.number)}**, dismissed them and restored the post.\n` +
        `[View it](https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id})`,
    ),
  );
  await modLog(guild, { ...logBase(guild, row, actor), title: 'Submission restored (reports dismissed)' });
  return `Submission ${label(row)} is visible again and its reports were cleared.`;
}

/** Private moderator note on the author of a submission. */
export async function noteAuthor(guild, row, actor, text) {
  db.addNote(guild.id, row.author_key, row.id, text, actor.id);
  await modLog(guild, { ...logBase(guild, row, actor), title: 'Note added', reason: text });
  return `Note saved on the author of ${label(row)}. See it with \`/mod history\`.`;
}
