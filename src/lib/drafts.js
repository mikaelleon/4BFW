// Preview and confirm (`/fw preview:on` or DM `fw preview on`): the author sees how the post will look and presses
// Post or Cancel. Drafts live in memory for ten minutes; nothing is stored or sent until Post.
import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as db from '../db.js';
import { COLOR, anonTitle } from './format.js';
import { confessionEmbed, submitConfession } from './confession.js';
import { postFiles, renderBody } from './render.js';
import { holdsImages, keep } from './held.js';
import { getTag } from './tags.js';

export const DRAFT_PREFIX = 'draft'; // buttons "draft:<post|cancel>:<token>"
const TTL_MS = 10 * 60_000;
const drafts = holdsImages(new Map()); // token -> { userId, guildId, content, replyTo, image, extras, expires }

setInterval(() => {
  const now = Date.now();
  for (const [token, d] of drafts) if (d.expires < now) drafts.delete(token);
}, 60_000).unref();

/** Text to tell the author after a submit. `inGuildName` adds the server (for DMs), `url` the link to the post. */
export function resultText(res, guild, { inGuildName = false, url = false } = {}) {
  if (!res.ok) return res.error;
  const where = inGuildName ? ` in **${guild.name}**` : '';
  if (res.pending) return `Your submission${where} was sent to the moderators for review. It goes up once it is approved.`;
  return `Posted as **${anonTitle(res.number)}**${where}.${url ? `\n${res.url}` : ''}`;
}

function previewPayload(guild, token, d) {
  const cfg = db.getGuild(guild.id);
  const tag = getTag(d.extras.tag);
  const { files, imageName } = postFiles(d.image, d.extras.cw);
  let body = renderBody(d.content, d.extras.cw);
  if (d.extras.pollOptions?.length) body += `${body ? '\n\n' : ''}${d.extras.pollOptions.map((o) => `🔘 ${o}`).join('\n')}`;
  const embed = confessionEmbed((cfg?.counter ?? 0) + 1, body, tag?.color ?? COLOR, imageName, d.extras.tag).setFooter({
    text: 'Preview · only you can see this',
  });
  const review = cfg?.approval_mode ? ' A moderator will review it before it goes up.' : '';
  return {
    content: `**Preview.** This is how your post will look in **${guild.name}**.${review} Post it?`,
    embeds: [embed],
    files,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${DRAFT_PREFIX}:post:${token}`).setLabel('Post it').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${DRAFT_PREFIX}:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

/**
 * Submit, or (when the user turned previews on) stash a draft and return the preview to show.
 * -> { result } after a real submit, or { preview } (a message payload) for the caller to send.
 */
export async function submitOrPreview(guild, userId, content, replyTo, image, extras = {}) {
  if (!db.getPrefs(userId).preview) return { result: await submitConfession(guild, userId, content, replyTo, image, extras) };
  const token = randomUUID().slice(0, 8);
  const draft = { userId, guildId: guild.id, content: (content ?? '').trim(), replyTo, image, extras, expires: Date.now() + TTL_MS };
  keep(drafts, token, draft);
  return { preview: previewPayload(guild, token, draft) };
}

/** Post it / Cancel under a preview. */
export async function handleDraftButton(interaction) {
  const [, action, token] = interaction.customId.split(':');
  const clear = { embeds: [], components: [], attachments: [] };
  const d = drafts.get(token);
  if (!d || d.userId !== interaction.user.id) {
    return interaction.update({ content: 'That preview expired. Send your submission again.', ...clear });
  }
  drafts.delete(token);
  if (action === 'cancel') return interaction.update({ content: 'Cancelled. Nothing was posted.', ...clear });

  await interaction.update({ content: 'Posting...', ...clear });
  const guild = interaction.client.guilds.cache.get(d.guildId);
  if (!guild) return interaction.editReply('I can no longer reach that server.');
  const res = await submitConfession(guild, d.userId, d.content, d.replyTo, d.image, d.extras);
  return interaction.editReply(resultText(res, guild, { inGuildName: !interaction.inGuild(), url: interaction.inGuild() }));
}
