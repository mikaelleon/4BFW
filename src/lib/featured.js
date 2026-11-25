// Featured channel: once a post collects enough 👍 it is copied to a channel the admin picks (/setup featured).
// The copy's counters follow later reactions; it is removed again if the original is deleted or hidden.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import * as db from '../db.js';
import { anonTitle } from './format.js';
import { postFiles, renderBody } from './render.js';
import { getTag, tagText } from './tags.js';

const busy = new Set(); // posts being featured right now, so two quick clicks cannot post it twice
const jump = (guildId, row) => `https://discord.com/channels/${guildId}/${row.channel_id}/${row.message_id}`;

function featuredEmbed(guildId, row, counts, imageName) {
  const tag = getTag(row.tag);
  const embed = new EmbedBuilder()
    .setColor(row.color ?? tag?.color ?? 0xf0b232)
    .setAuthor({ name: '⭐ Featured submission' })
    .setTitle(anonTitle(row.number))
    .setDescription(`${renderBody(row.rendered ?? row.content, row.cw)}\n\n👍 **${counts.up}**  ·  [Jump to post](${jump(guildId, row)})`.trim())
    .setImage(`attachment://${imageName}`);
  if (tag) embed.setFooter({ text: tagText(row.tag) });
  return embed;
}

/** Call after a reaction changed: features the post when it reaches the threshold, or refreshes its counters. */
export async function maybeFeature(guild, row) {
  const cfg = db.getGuild(guild.id);
  if (!cfg?.featured_channel_id) return;
  const fresh = db.getConfession(guild.id, row.id);
  if (!fresh || fresh.status !== 'posted' || fresh.purged_at) return;

  const counts = db.reactionCounts(fresh.id);
  const image = fresh.has_image ? db.getConfessionImage(fresh.id) : null;
  const { files, imageName } = postFiles(image, fresh.cw);

  if (fresh.featured_message_id) {
    const channel = await guild.channels.fetch(fresh.featured_channel_id).catch(() => null);
    // No `files`: the copy keeps its attachments, the embed just gets new numbers.
    await channel?.messages.edit(fresh.featured_message_id, { embeds: [featuredEmbed(guild.id, fresh, counts, imageName)] }).catch(() => {});
    return;
  }
  if (counts.up < (cfg.featured_threshold || 5) || busy.has(fresh.id)) return;

  busy.add(fresh.id);
  try {
    const channel = await guild.channels.fetch(cfg.featured_channel_id).catch(() => null);
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (!channel || !channel.permissionsFor(me)?.has(needed)) return;
    const msg = await channel.send({ embeds: [featuredEmbed(guild.id, fresh, counts, imageName)], files, allowedMentions: { parse: [] } });
    db.setFeatured(fresh.id, channel.id, msg.id);
  } catch (err) {
    console.error('Featuring failed:', err);
  } finally {
    busy.delete(fresh.id);
  }
}

/** Take the copy down (original deleted or hidden). */
export async function removeFeatured(guild, row) {
  if (!row.featured_message_id) return;
  const channel = await guild.channels.fetch(row.featured_channel_id).catch(() => null);
  await channel?.messages.delete(row.featured_message_id).catch(() => {});
  db.setFeatured(row.id, null, null);
}
