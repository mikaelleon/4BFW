// Button reactions (👍 👎) and poll votes under submissions. One choice per person, clicking it again withdraws it.
// Nobody sees who voted: the user id is stored only to enforce the one-vote rule.
// Polls end at their end time or when the author (or a moderator) presses Close poll; results go in a reply.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import * as db from '../db.js';
import { LIKERT, MAX_POLL_OPTIONS, YES_NO, buildPost, fetchPostMessage, postComponents } from './confession.js';
import { isModerator } from './context.js';
import { maybeFeature } from './featured.js';
import { COLOR, anonTitle } from './format.js';
import { userKey } from './identity.js';
import { getTag } from './tags.js';

export const MAX_OPTION_LEN = 40;
const KINDS = new Set(['up', 'down']);
const EPHEMERAL = MessageFlags.Ephemeral;

/** Poll options typed by a user (one per line, or split by `|` for the slash command). Empty = not a poll. "yes/no" = a yes-or-no poll. */
export function parsePollOptions(text, separator = /\r?\n/) {
  const raw = (text ?? '').trim();
  if (!raw) return { options: null };
  if (/^(yes\s*(\/|,|or)\s*no|yes\s*no|y\s*\/\s*n)$/i.test(raw)) return { options: [...YES_NO] };
  if (/^likert(\s+scale)?$/i.test(raw)) return { options: [...LIKERT] };
  const options = raw
    .split(separator)
    .map((o) => o.trim())
    .filter(Boolean);
  if (options.length === 2 && options[0].toLowerCase() === 'yes' && options[1].toLowerCase() === 'no') return { options: [...YES_NO] };
  if (options.length < 2 || options.length > MAX_POLL_OPTIONS) return { error: `A poll needs 2 to ${MAX_POLL_OPTIONS} options, or just \`yes/no\`.` };
  if (options.some((o) => o.length > MAX_OPTION_LEN)) return { error: `Each poll option can be at most ${MAX_OPTION_LEN} characters.` };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { error: 'Poll options must all be different.' };
  return { options };
}

const gone = (interaction, text = 'That submission is no longer available.') => interaction.reply({ content: text, flags: EPHEMERAL });

async function targetOf(interaction) {
  if (!interaction.inGuild()) return null;
  const target = await db.getConfessionByMessage(interaction.guildId, interaction.message.id);
  return target && target.status === 'posted' ? target : null;
}

export async function handleReactionButton(interaction) {
  const kind = interaction.customId.split(':')[2];
  const target = await targetOf(interaction);
  if (!target || !KINDS.has(kind)) return gone(interaction);
  await db.toggleReaction(target.id, interaction.user.id, kind);
  await interaction.update({ components: await postComponents(await db.getConfession(interaction.guildId, target.id)) });
  // Featured channel (/setup featured): may now qualify, or its copy needs new numbers.
  const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId).catch(() => null));
  if (guild) maybeFeature(guild, target).catch((err) => console.error('Feature check failed:', err));
}

export async function handleVoteButton(interaction) {
  const idx = Number(interaction.customId.split(':')[2]);
  const target = await targetOf(interaction);
  if (!target || !target.is_poll || !(await db.getPollOptions(target.id)).some((o) => o.idx === idx)) return gone(interaction);
  if (target.poll_closed_at) return gone(interaction, 'This poll is closed.');
  if ((await db.togglePollVote(target.id, interaction.user.id, idx)) === undefined) return gone(interaction, 'This poll is closed.');
  // Read again: the poll may have closed meanwhile, and old data would switch its buttons back on.
  return interaction.update({ components: await postComponents(await db.getConfession(interaction.guildId, target.id)) });
}

/* ---------- closing a poll ---------- */

const BAR = 10;

/** Results card: one bar per option, the winner (or winners) marked. */
async function resultsEmbed(row) {
  const options = await db.getPollOptions(row.id);
  const votes = await db.pollCounts(row.id);
  const counts = options.map((o) => votes.get(o.idx) ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...counts);
  const lines = options.map((o, i) => {
    const share = total ? counts[i] / total : 0;
    const filled = Math.round(share * BAR);
    const mark = top > 0 && counts[i] === top ? '🏆' : '▫️';
    return `${mark} **${o.label}**\n\`${'█'.repeat(filled)}${'░'.repeat(BAR - filled)}\` ${Math.round(share * 100)}% (${counts[i]})`;
  });
  const question = row.content ? `${row.cw ? '*(content warning)*' : row.content}\n\n` : '';
  return new EmbedBuilder()
    .setColor(row.color ?? getTag(row.tag)?.color ?? COLOR)
    .setTitle(`📊 Poll results · ${anonTitle(row.number)}`)
    .setDescription(`${question}${lines.join('\n\n')}\n\n**${total}** vote${total === 1 ? '' : 's'}`);
}

/** Lock the voting buttons, mark the poll closed and reply with the results. False when it was not open. */
export async function closePoll(guild, row) {
  const fresh = await db.getConfession(guild.id, row.id);
  if (!fresh?.is_poll || fresh.poll_closed_at || fresh.status !== 'posted') return false;
  if (!await db.closePollRow(fresh.id)) return false;
  const closed = await db.getConfession(guild.id, fresh.id);
  const msg = await fetchPostMessage(guild, closed);
  if (!msg) return false;
  const image = closed.has_image ? await db.getConfessionImage(closed.id) : null;
  const post = await buildPost(closed, image);
  // Only the embed and buttons change; the attachments stay as they are.
  // An image can be missing from the database (left out of a restored backup): point at the one already on the message.
  const kept = closed.has_image && !image && !closed.cw ? msg.attachments.first()?.name : null;
  if (kept) post.embeds[0].setImage(`attachment://${kept}`);
  await msg.edit({ embeds: post.embeds, components: post.components });
  await msg.reply({ embeds: [await resultsEmbed(closed)], allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  return true;
}

/** "Close poll" button: the author of the poll, or a moderator. */
export async function handleClosePollButton(interaction) {
  const target = await targetOf(interaction);
  if (!target?.is_poll) return gone(interaction);
  const isAuthor = target.author_key === userKey(interaction.guildId, interaction.user.id);
  const isMod = isModerator(interaction.member, interaction.memberPermissions, await db.getGuild(interaction.guildId));
  if (!isAuthor && !isMod) return gone(interaction, 'Only the author of this poll, or a moderator, can close it.');
  await interaction.deferUpdate();
  const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId));
  await closePoll(guild, target);
}

/** Scheduler: close every poll whose end time has passed. */
export async function sweepPolls(client) {
  for (const row of await db.listDuePolls()) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue;
    await closePoll(guild, row).catch((err) => console.error(`Closing poll ${row.id} failed:`, err));
  }
}
