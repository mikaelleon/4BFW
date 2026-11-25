// The DMs a moderated user receives: warning, ban and removal. They share one layout so they read alike:
// what happened, why, which post, where they stand, and what they can do next.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { anonRef, anonTitle, formatDateTime } from './format.js';

export const RULES_PREFIX = 'rules'; // button "rules:<guildId>" opens the guide's rules page
export const APPEAL_FORM_PREFIX = 'appealform'; // button "appealform:<guildId>" starts the appeal form (see appeals.js)

const COLORS = { yellow: 0xfee75c, orange: 0xe67e22, red: 0xed4245 };
const SQUARES = { yellow: '🟨', orange: '🟧', red: '🟥' };
const RULES_BUTTON_TEXT = 'Read the rules before your next post (button below)';const SAFE_NOTE = 'You can still read the channel, but you can no longer post in this server.';

/** Warning id as users see it: 42 -> "W-0042". */
export const warningCode = (id) => `W-${String(id).padStart(4, '0')}`;

/** "W-0042", "w-42" or "42" -> 42 (null when it is not an id). */
export function parseWarningCode(text) {
  const match = /^\s*w?\s*-?\s*0*(\d{1,9})\s*$/i.exec(text ?? '');
  return match ? Number(match[1]) : null;
}

/** One-line excerpt of a post, cut to about 100 characters. */
export function excerpt(content, max = 100) {
  const flat = (content ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '(image)';
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Yellow below half of the limit, orange from half, red at the limit. */
function level(count, limit) {
  const ratio = count / limit;
  return ratio >= 1 ? 'red' : ratio >= 0.5 ? 'orange' : 'yellow';
}

/** Filled squares in the level's color, empty ones after. Skipped for big limits where it would not fit. */
function progressBar(count, limit, color) {
  if (limit > 10) return '';
  return `${SQUARES[color].repeat(Math.min(count, limit))}${'⬜'.repeat(Math.max(0, limit - count))}`;
}

/** `appeal` = also add the Appeal button (warning and ban DMs; a plain removal has nothing to appeal). */
function build(guild, color, title, lines, appeal = false) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `4BFW • ${formatDateTime()}` });
  const rules = new ButtonBuilder().setCustomId(`${RULES_PREFIX}:${guild.id}`).setLabel('Read the rules').setStyle(ButtonStyle.Secondary);
  const row = new ActionRowBuilder().addComponents(rules);
  if (appeal) row.addComponents(new ButtonBuilder().setCustomId(`${APPEAL_FORM_PREFIX}:${guild.id}`).setLabel('Appeal').setStyle(ButtonStyle.Primary));
  return { embeds: [embed], components: [row] };
}

const reasonLine = (reason) => `**Reason:** ${reason ?? 'No reason given'}`;
// Only the public number is shown: the admin-only Submission ID never reaches users.
// The text itself is not repeated in the DM: link to the post, or to its channel once the post is gone (a deleted message's link is dead).
function postLine(guild, row, gone) {
  const label = anonRef(row.number);
  if (!row.channel_id) return `**Post:** ${label}`;
  if (gone || !row.message_id) return `**Post:** ${label} in <#${row.channel_id}>`;
  return `**Post:** [${label}](https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id})`;
}
const removed = (deleted) => (deleted ? ' and has been removed' : '');

/**
 * Warning DM. At the limit the progress section is replaced by the posting restriction (`banned`).
 * 1/3 reads friendly, 2/3 says the next warning restricts posting.
 */
export function warningNotice(guild, row, { reason, warningId, count, limit, expiryDays = 0, banned = false, deleted = false }) {
  const color = level(count, limit);
  const lead = color === 'yellow' && !banned ? 'Heads up: your' : 'Your';
  const lines = [
    `${lead} **${anonTitle(row.number)}** was found to violate our community guidelines${removed(deleted)}.`,
    '',
    reasonLine(reason),
    postLine(guild, row, deleted),
    '',
  ];

  if (banned) {
    lines.push(`**Posting disabled:** you reached ${limit} warnings, so posting is turned off for you here (permanent). ${SAFE_NOTE}`);
  } else {
    lines.push(`**Warnings:** ${count}/${limit}  ${progressBar(count, limit, color)}`.trimEnd());
    lines.push(`At ${limit} warnings, posting is disabled in this server. You can still read the channel.`);
    if (count === limit - 1) lines.push('**Your next warning will restrict posting.**');
  }
  // The restriction itself does not expire with the warnings, so this line only belongs on the not-yet-banned versions.
  if (expiryDays > 0 && !banned) lines.push(`Warnings expire after ${expiryDays} days.`);

  lines.push(
    '',
    '**What you can do**',
    `- ${RULES_BUTTON_TEXT}`,
    '- Think this was a mistake? Press **Appeal** below.',
  );
  return build(guild, COLORS[banned ? 'red' : color], `Warning in ${guild.name}`, lines, true);
}

/** Ban DM. `until` = Discord timestamp text for a timed ban, or null for a permanent one. */
export function banNotice(guild, row, { reason, until = null, deleted = false }) {
  return build(guild, COLORS.red, `Posting disabled in ${guild.name}`, [
    `Your **${anonTitle(row.number)}** was found to violate our community guidelines${removed(deleted)}, and posting has been disabled.`,
    '',
    reasonLine(reason),
    postLine(guild, row, deleted),
    '',
    `**Posting disabled:** ${until ? `until ${until}` : 'permanently'}. ${SAFE_NOTE}`,
    '',
    '**What you can do**',
    `- ${RULES_BUTTON_TEXT}`,
    '- Think this was a mistake? Press **Appeal** below and a moderator will review it.',
  ], true);
}

/** Removal DM (a moderator deleted the post without warning or banning). */
export function deletionNotice(guild, row, { reason }) {
  return build(guild, COLORS.orange, `Post removed in ${guild.name}`, [
    `Your **${anonTitle(row.number)}** was found to violate our community guidelines and has been removed.`,
    '',
    reasonLine(reason),
    postLine(guild, row, true),
    '',
    '**Warning:** none. A removal on its own does not count towards the warning limit.',
    '',
    '**What you can do**',
    `- ${RULES_BUTTON_TEXT}`,
    `- Think this was a mistake? Message a moderator of **${guild.name}**.`,
  ]);
}
