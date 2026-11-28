import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { controlsRow } from './controls-row.js';
import { COLOR, anonRef, formatDateTime } from './format.js';
import { PAD_NAME, padPng } from './pad.js';
import { tagText } from './tags.js';

const MAX_CONTENT = 3000;

/** "> " quote every line so the original text reads as a quote block. */
function quote(text) {
  const clipped = text.length > MAX_CONTENT ? `${text.slice(0, MAX_CONTENT)}…` : text;
  return clipped
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Post to the admin log channel: the submission's text and jump link, its admin-only ID, topic, public number
 * and the time. `authorId` is accepted by callers but never displayed. Fixed width (see pad.js), shared embed color, no footer.
 * `controls: true` adds the Warn / Delete / Ban buttons (used on new-submission entries).
 */
export async function modLog(guild, { title, id, subId, number, actor, reason, url, content, authorId, hasImage, controls = false, components = null, fields = [], ping = null }) {
  const cfg = await db.getGuild(guild.id);
  if (!cfg?.log_channel_id) return;
  const channel = await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
  if (!channel) return;

  // The stored image (if any) is attached to every entry about this submission, so mods see what was posted.
  const image = hasImage && id ? await db.getConfessionImage(id) : null;

  // The sender ID is never shown here: the server owner looks it up with /sender (see owner-pin.js).
  const row = id ? await db.getConfession(guild.id, id) : null;
  // The per-server Submission ID, read from the stored post. `id` is the internal key and must never be shown: /mod would
  // act on a different submission. Entries not about one post (a ban appeal) have none.
  const subNo = row?.sub_id ?? subId;
  const lead = [tagText(row?.tag), row?.is_poll ? '📊 Poll' : null].filter(Boolean).join(' · '); // topic sits right under the title

  const parts = [];
  if (lead) parts.push(lead);
  if (content) parts.push(quote(content));
  if (hasImage && !image) parts.push('*Included an image (no longer stored)*');
  if (url) parts.push(`[Jump to message](${url})`);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .addFields(
      ...(subNo != null ? [{ name: 'Public number', value: number ? anonRef(number) : 'Assigned on approval', inline: true }] : []),
      ...(actor ? [{ name: 'Moderator', value: `<@${actor.id}>`, inline: true }] : []),
      { name: 'Timestamp', value: formatDateTime(), inline: true },
    )
    .setImage(`attachment://${image ? image.name : PAD_NAME}`);
  // Title = the Submission ID; what happened ("Submission approved") moves to the line above it.
  if (subNo != null) {
    embed.setTitle(`Submission ID ${subNo}`);
    if (title) embed.setAuthor({ name: title });
  } else if (title) embed.setTitle(title);
  if (parts.length) embed.setDescription(parts.join('\n\n'));
  if (fields.length) embed.addFields(fields);
  if (reason) embed.addFields({ name: 'Reason', value: reason.slice(0, 1000) });

  const payload = {
    // `ping` = a role id to notify (the moderator role); nothing else in the entry can ping anyone.
    content: ping ? `<@&${ping}>` : undefined,
    embeds: [embed],
    files: [image ? new AttachmentBuilder(image.buffer, { name: image.name }) : new AttachmentBuilder(padPng(), { name: PAD_NAME })],
    allowedMentions: ping ? { roles: [ping] } : { parse: [] },
  };
  if (components) payload.components = components; // e.g. the Overturn / Uphold buttons on an appeal
  else if (controls) {
    const row = await db.getConfession(guild.id, id);
    if (row) payload.components = [controlsRow(row, Boolean(await db.getBan(guild.id, row.author_key)))];
  }
  await channel.send(payload).catch(() => {});
}

/** A log entry that is not about one submission (e.g. a timed ban ending). */
export async function systemLog(guild, title, description) {
  const cfg = await db.getGuild(guild.id);
  if (!cfg?.log_channel_id) return;
  const channel = await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
  const embed = new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(description).setFooter({ text: formatDateTime() });
  await channel?.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

/** `embed` = one EmbedBuilder, or a ready message payload ({ embeds, components }). */
export async function dmUser(client, userId, embed) {
  if (!userId) return false; // sender ID already purged (data retention)
  try {
    const user = await client.users.fetch(userId);
    await user.send(embed?.embeds ? embed : { embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

export function notice(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `STFW • ${formatDateTime()}` });
}
