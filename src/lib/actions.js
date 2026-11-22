// Moderation actions shared by the /mod slash commands and the buttons under each mod-log entry.
import * as db from '../db.js';
import { deleteConfessionMessage } from './confession.js';
import { anonRef, anonTitle } from './format.js';
import { dmUser, modLog, notice } from './moderation.js';

const label = (row) => `ID \`${row.id}\` (public ${anonRef(row.number)})`;
const isLive = (row) => row.status === 'posted' && row.channel_id && row.message_id;

/** Fields every log entry carries: the submission's text, sender and (while it exists) jump link. */
function logBase(guild, row, actor, { gone = false } = {}) {
  return {
    id: row.id,
    number: row.number,
    actor,
    content: row.content,
    hasImage: Boolean(row.has_image),
    authorId: row.author_id,
    url: !gone && isLive(row) ? `https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id}` : null,
  };
}

export async function deleteSubmission(guild, row, actor, reason) {
  await deleteConfessionMessage(guild, row);
  await modLog(guild, { ...logBase(guild, row, actor, { gone: true }), title: 'Submission deleted', reason });
  return `Submission ${label(row)} deleted.`;
}

export async function warnAuthor(client, guild, row, actor, reason, { alsoDelete = false } = {}) {
  const cfg = db.getGuild(guild.id);
  const limit = cfg.warn_limit;
  db.addWarning(guild.id, row.author_id, row.id, reason);
  const count = db.countWarnings(guild.id, row.author_id);
  if (alsoDelete) await deleteConfessionMessage(guild, row);
  const base = logBase(guild, row, actor, { gone: alsoDelete });

  const dmed = await dmUser(
    client,
    row.author_id,
    notice(
      `Warning in ${guild.name}`,
      `Your **${anonTitle(row.number)}** broke the rules.\n**Reason:** ${reason ?? 'No reason given'}\n\nWarnings: **${count}/${limit}**. ` +
        `At ${limit} you lose the ability to post in this server.`,
    ),
  );
  await modLog(guild, { ...base, title: `Author warned (${count}/${limit})`, reason });

  let out = `Warned the author of ${label(row)} (${count}/${limit}). ${dmed ? 'They were notified.' : 'Their DMs are closed, so they were not notified.'}`;
  if (count >= limit && !db.getBan(guild.id, row.author_id)) {
    db.banUser(guild.id, row.author_id, `Reached ${limit} warnings`, actor.id);
    await dmUser(client, row.author_id, notice(`Banned from posting in ${guild.name}`, `You reached ${limit} warnings.`));
    await modLog(guild, { ...base, title: 'Author auto-banned (warn limit)', reason: `Reached ${limit} warnings` });
    out += '\nWarn limit reached: the author is now **banned** from posting.';
  }
  return out;
}

export async function banAuthor(client, guild, row, actor, reason, { alsoDelete = true } = {}) {
  const already = db.getBan(guild.id, row.author_id);
  db.banUser(guild.id, row.author_id, reason ?? 'No reason given', actor.id);
  if (alsoDelete) await deleteConfessionMessage(guild, row);
  if (!already) {
    await dmUser(
      client,
      row.author_id,
      notice(`Banned from posting in ${guild.name}`, `Because of **${anonTitle(row.number)}**.\n**Reason:** ${reason ?? 'No reason given'}`),
    );
  }
  await modLog(guild, { ...logBase(guild, row, actor, { gone: alsoDelete }), title: 'Author banned', reason });
  return already ? 'That author was already banned. Reason updated.' : `Author of ${label(row)} is banned from posting.`;
}

export async function unbanAuthor(client, guild, row, actor, { clearWarnings = true } = {}) {
  if (!db.unbanUser(guild.id, row.author_id)) return 'That author is not banned.';
  if (clearWarnings) db.clearWarnings(guild.id, row.author_id);
  await dmUser(client, row.author_id, notice(`Ban lifted in ${guild.name}`, 'You can post again. Please follow the rules.'));
  await modLog(guild, { ...logBase(guild, row, actor), title: 'Author unbanned' });
  return `Author of ${label(row)} can post again.`;
}
