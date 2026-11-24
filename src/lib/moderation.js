import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { controlsRow } from './controls-row.js';
import { COLOR, anonRef, formatDateTime } from './format.js';
import { PAD_NAME, padPng } from './pad.js';

const MAX_CONTENT = 3000;
// An empty inline field. Three columns per row keeps "Sender ID" under the ID and the timestamp under the number.
const BLANK = { name: '​', value: '​', inline: true };

/** "> " quote every line so the original text reads as a quote block. */
function quote(text) {
  const clipped = text.length > MAX_CONTENT ? `${text.slice(0, MAX_CONTENT)}…` : text;
  return clipped
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Post to the admin log channel: the submission's text and jump link, its admin-only ID, public number, sender
 * and the time. Fixed width (see pad.js), shared embed color, no footer.
 * `controls: true` adds the Warn / Delete / Ban buttons (used on new-submission entries).
 */
export async function modLog(guild, { title, id, number, actor, reason, url, content, authorId, hasImage, controls = false }) {
  const cfg = db.getGuild(guild.id);
  if (!cfg?.log_channel_id) return;
  const channel = await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
  if (!channel) return;

  // The stored image (if any) is attached to every entry about this submission, so mods see what was posted.
  const image = hasImage && id ? db.getConfessionImage(id) : null;

  const parts = [];
  if (content) parts.push(quote(content));
  if (hasImage && !image) parts.push('*Included an image (no longer stored)*');
  if (url) parts.push(`[Jump to message](${url})`);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .addFields(
      { name: 'Submission ID', value: `\`${id}\``, inline: true },
      { name: 'Public number', value: anonRef(number), inline: true },
      actor ? { name: 'Moderator', value: `<@${actor.id}>`, inline: true } : BLANK,
      authorId ? { name: 'Sender ID', value: `||${authorId}||`, inline: true } : BLANK,
      { name: 'Timestamp', value: formatDateTime(), inline: true },
      BLANK,
    )
    .setImage(`attachment://${image ? image.name : PAD_NAME}`);
  if (title) embed.setTitle(title);
  if (parts.length) embed.setDescription(parts.join('\n\n'));
  if (reason) embed.addFields({ name: 'Reason', value: reason.slice(0, 1000) });

  const payload = {
    embeds: [embed],
    files: [image ? new AttachmentBuilder(image.buffer, { name: image.name }) : new AttachmentBuilder(padPng(), { name: PAD_NAME })],
    allowedMentions: { parse: [] },
  };
  if (controls) {
    const row = db.getConfession(guild.id, id);
    if (row) payload.components = [controlsRow(row, Boolean(db.getBan(guild.id, row.author_id)))];
  }
  await channel.send(payload).catch(() => {});
}

export async function dmUser(client, userId, embed) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
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
    .setFooter({ text: `4BFW • ${formatDateTime()}` });
}
