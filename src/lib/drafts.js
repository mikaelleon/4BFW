// Questions asked before a submission is saved. Preview (`/fw preview:on` or DM `fw preview on`): the author sees how
// the post will look and presses Post or Cancel. Posting on hold: the author is told when it would go up and presses
// Post later or Cancel. Drafts live in memory for ten minutes; nothing is stored or sent until the author agrees.
import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import * as db from '../db.js';
import { COLOR, anonTitle } from './format.js';
import { confessionEmbed, expectedTime, submitConfession, whyCannotPost } from './confession.js';
import { holdPrompt, postingMode } from './hours.js';
import { postFiles, renderBody } from './render.js';
import { holdsImages, keep } from './held.js';
import { getTag } from './tags.js';

export const DRAFT_PREFIX = 'draft'; // buttons "draft:<post|later|cancel>:<token>"
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
  if (res.pending) {
    const after = res.onHold ? ' Posting is on hold, so it goes up after it is approved and posting resumes.' : ' It goes up once it is approved.';
    return `Your submission${where} was sent to the moderators for review.${after}`;
  }
  if (res.scheduled) return `Saved. Your submission${where} will be posted ${expectedTime(res.resumesAt)}. I will DM you when it is up.`;
  const as = res.alias ? ` (you appear as **${res.alias}**)` : '';
  return `Posted as **${anonTitle(res.number)}**${where}${as}.${url ? `\n${res.url}` : ''}`;
}

const buttons = (token, confirm, label) => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${DRAFT_PREFIX}:${confirm}:${token}`).setLabel(label).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${DRAFT_PREFIX}:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  ),
];

async function previewPayload(guild, token, d) {
  const cfg = await db.getGuild(guild.id);
  const tag = getTag(d.extras.tag);
  const { files, imageName } = postFiles(d.image, d.extras.cw);
  let body = renderBody(d.content, d.extras.cw);
  if (d.extras.pollOptions?.length) body += `${body ? '\n\n' : ''}${d.extras.pollOptions.map((o) => `🔘 ${o}`).join('\n')}`;
  const embed = confessionEmbed((cfg?.counter ?? 0) + 1, body, tag?.color ?? COLOR, imageName, d.extras.tag).setFooter({
    text: 'Preview · only you can see this',
  });
  const review = cfg?.approval_mode ? ' A moderator will review it before it goes up.' : '';
  const held = postingMode(cfg) === 'hold';
  const question = held ? `\n\n${holdPrompt(cfg)}` : ' Post it?';
  return {
    content: `**Preview.** This is how your post will look in **${guild.name}**.${review}${question}`,
    embeds: [embed],
    files,
    components: held ? buttons(token, 'later', 'Post later') : buttons(token, 'post', 'Post it'),
    allowedMentions: { parse: [] },
  };
}

function stash(userId, guildId, content, replyTo, image, extras) {
  const token = randomUUID().slice(0, 8);
  const draft = { userId, guildId, content: (content ?? '').trim(), replyTo, image, extras, expires: Date.now() + TTL_MS };
  keep(drafts, token, draft);
  return { token, draft };
}

/** "Posting is paused ... Post later / Cancel", holding the submission in memory until the author answers. */
function holdQuestion(guild, prompt, userId, content, replyTo, image, extras) {
  const { token } = stash(userId, guild.id, content, replyTo, image, extras);
  return { content: `In **${guild.name}**:\n${prompt}`, components: buttons(token, 'later', 'Post later'), allowedMentions: { parse: [] } };
}

/**
 * Submit, or return a question to show first (a preview, or the posting-on-hold confirmation).
 * -> { result } after a submit, or { preview } (a message payload) for the caller to send.
 */
export async function submitOrPreview(guild, userId, content, replyTo, image, extras = {}) {
  if ((await db.getPrefs(userId)).preview) {
    // Someone who cannot submit gets the reason straight away instead of a preview that fails on the button.
    const blocked = await whyCannotPost(guild, userId);
    if (blocked) return { result: { ok: false, error: blocked } };
    const { token, draft } = stash(userId, guild.id, content, replyTo, image, extras);
    return { preview: await previewPayload(guild, token, draft) };
  }
  const result = await submitConfession(guild, userId, content, replyTo, image, extras);
  if (result.needsConfirm) return { preview: holdQuestion(guild, result.prompt, userId, content, replyTo, image, extras) };
  return { result };
}

/** Post it / Post later / Cancel under a question. */
export async function handleDraftButton(interaction) {
  const [, action, token] = interaction.customId.split(':');
  const clear = { embeds: [], components: [], attachments: [] };
  const d = drafts.get(token);
  if (!d || d.userId !== interaction.user.id || d.expires < Date.now()) {
    return interaction.update({ content: 'That request expired, so nothing was saved. Send your submission again.', ...clear });
  }
  drafts.delete(token);
  if (action === 'cancel') return interaction.update({ content: 'Cancelled. Nothing was saved or posted.', ...clear });

  await interaction.update({ content: action === 'later' ? 'Saving...' : 'Posting...', ...clear });
  const guild = interaction.client.guilds.cache.get(d.guildId);
  if (!guild) return interaction.editReply('I can no longer reach that server.');
  const res = await submitConfession(guild, d.userId, d.content, d.replyTo, d.image, { ...d.extras, acceptDelay: action === 'later' });
  // Posting was paused after the preview was shown: ask about waiting.
  if (res.needsConfirm) return interaction.editReply(holdQuestion(guild, res.prompt, d.userId, d.content, d.replyTo, d.image, d.extras));
  return interaction.editReply(resultText(res, guild, { inGuildName: !interaction.inGuild(), url: interaction.inGuild() }));
}
