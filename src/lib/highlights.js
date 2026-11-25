// "Confession of the day / week": the most-liked post of the period, posted in a channel the admin picks.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import * as db from '../db.js';
import { anonTitle } from './format.js';
import { postFiles, renderBody } from './render.js';
import { getTag, tagText } from './tags.js';

const DAY_MS = 86_400_000;
const PERIODS = [
  { key: 'daily', label: 'day', field: 'highlight_daily_at', ms: DAY_MS },
  { key: 'weekly', label: 'week', field: 'highlight_weekly_at', ms: 7 * DAY_MS },
];
const wants = (setting, key) => setting === key || setting === 'both';

/** Settings patch for /setup highlights: timers start now for any period that was off before. */
export function highlightTimers(cfg, setting) {
  const patch = {};
  for (const p of PERIODS) {
    if (wants(setting, p.key) && (!cfg?.[p.field] || !wants(cfg?.highlight_period, p.key))) patch[p.field] = Date.now();
  }
  return patch;
}

async function postHighlight(guild, cfg, period, row) {
  const channel = await guild.channels.fetch(cfg.highlight_channel_id).catch(() => null);
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (!channel || !channel.permissionsFor(me)?.has(needed)) return;

  const image = row.has_image ? db.getConfessionImage(row.id) : null;
  const files = postFiles(image, row.cw);
  const tag = getTag(row.tag);
  const url = `https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id}`;
  const embed = new EmbedBuilder()
    .setColor(row.color ?? tag?.color ?? 0xf0b232)
    .setAuthor({ name: `🏆 Confession of the ${period.label}` })
    .setTitle(anonTitle(row.number))
    .setDescription(`${renderBody(row.rendered ?? row.content ?? '', row.cw)}\n\n👍 **${row.ups}**  👎 **${row.downs}**  ·  [Jump to post](${url})`.trim())
    .setImage(`attachment://${files.imageName}`);
  if (tag) embed.setFooter({ text: tagText(row.tag) });
  await channel.send({
    embeds: [embed],
    files: files.files,
    allowedMentions: { parse: [] },
  });
}

/** Called every minute: post whichever highlights are due. Windows are rolling (the last 24 h / 7 days since the previous one). */
export async function runHighlights(client) {
  const now = Date.now();
  for (const cfg of db.guildsWithHighlights()) {
    const guild = client.guilds.cache.get(cfg.guild_id);
    if (!guild) continue;
    for (const p of PERIODS) {
      if (!wants(cfg.highlight_period, p.key)) continue;
      const last = cfg[p.field];
      if (!last || now - last < p.ms) continue;
      // Mark first: a failed send must not retry every minute.
      db.updateGuild(guild.id, { [p.field]: now });
      const top = db.topLikedSince(guild.id, now - p.ms);
      if (!top) continue; // nothing was liked this period
      await postHighlight(guild, cfg, p, top).catch((err) => console.error(`Highlight failed for ${guild.id}:`, err));
    }
  }
}
