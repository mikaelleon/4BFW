// /clearwarn: the server owner (after the PIN) lifts one warning, all warnings, or the posting ban of a user, who is told
// by DM. The mod-log entry never names the user, so it cannot link a person to their submissions for the moderators.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import * as db from '../db.js';
import { dmUser, modLog, notice } from './moderation.js';
import { warningCode } from './notices.js';
import { isOwner } from './owner-pin.js';

export const CLEARWARN_PREFIX = 'clearwarn'; // dropdown "clearwarn:pick:<userId>", button "clearwarn:dismiss"

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const day = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// A reason typed on the command is kept for the pick list that follows (it is too long for a button id).
const reasons = new Map(); // "<moderator id>:<user id>" -> reason
export function rememberReason(modId, userId, reason) {
  if (reason) reasons.set(`${modId}:${userId}`, reason);
  else reasons.delete(`${modId}:${userId}`);
}

/**
 * `what` = a warning id (number), 'all' (every warning) or 'ban'.
 * Returns the text to show the moderator.
 */
export async function liftForUser(client, guild, userId, what, actor, reason = null) {
  let title;
  let lifted;
  const fields = [];

  if (what === 'ban') {
    if (!await db.unbanUser(guild.id, userId)) return 'That user is not banned.';
    const appeal = await db.latestBanAppeal(guild.id, userId);
    if (appeal?.status === 'open') await db.resolveBanAppeal(appeal.id, 'lifted', actor.id);
    title = 'Ban lifted';
    lifted = 'your posting ban. You can post again';
  } else {
    const all = await db.listWarnings(guild.id, userId); // only this user's, so a code belonging to someone else is "not found"
    const targets = what === 'all' ? all : all.filter((w) => w.id === what);
    if (!targets.length) return what === 'all' ? 'That user has no warnings.' : `That user has no warning \`${warningCode(what)}\`.`;
    for (const w of targets) {
      if ((await db.getAppeal(w.id))?.status === 'open') await db.resolveAppeal(w.id, 'overturned', actor.id);
      await db.deleteWarning(w.id);
    }
    const codes = targets.map((w) => warningCode(w.id)).join(', ');
    title = targets.length === 1 ? 'Warning cleared' : 'Warnings cleared';
    lifted = `${targets.length === 1 ? 'warning' : 'warnings'} **${clip(codes, 800)}**`;
    fields.push({ name: targets.length === 1 ? 'Warning ID' : 'Warning IDs', value: clip(codes, 1000) });
  }

  const cfg = await db.getGuild(guild.id);
  const banned = Boolean(await db.getBan(guild.id, userId));
  const standing = [
    what === 'ban' ? null : `Active warnings: **${await db.countWarnings(guild.id, userId)}/${cfg.warn_limit}**`,
    banned ? 'Your posting ban is still in place.' : null,
  ].filter(Boolean);
  const dmed = await dmUser(
    client,
    userId,
    notice(
      `${title} in ${guild.name}`,
      [`A moderator lifted ${lifted}.`, reason ? `**Reason:** ${reason}` : null, ...standing].filter(Boolean).join('\n'),
    ),
  );
  await modLog(guild, { title, actor, reason, fields }).catch(() => {});

  const done = what === 'ban' ? 'Ban lifted.' : `${title}.`;
  const told = dmed ? 'The user was notified.' : 'Their DMs are closed, so they were not notified.';
  const still = banned ? '\nThey are **still banned**. Run `/clearwarn` for them and pick **Lift posting ban** if that should go too.' : '';
  return `${done} ${told}${still}`;
}

/** The private pick list: each warning, "clear all", the ban if there is one, and a Dismiss button. */
export async function clearPanel(guild, userId, note = null) {
  const warnings = await db.listWarnings(guild.id, userId);
  const ban = await db.getBan(guild.id, userId);
  const options = [];
  if (warnings.length) options.push({ label: `Clear all warnings (${warnings.length})`, value: 'all', emoji: '🧹' });
  if (ban) options.push({ label: 'Lift posting ban', description: clip(ban.reason ?? 'No reason given', 100), value: 'ban', emoji: '🔓' });
  for (const w of warnings.slice(0, 25 - options.length)) {
    options.push({
      label: `${warningCode(w.id)} · ${day(w.created_at)}${w.expired ? ' (expired)' : ''}`,
      description: clip(w.reason || 'No reason given', 100),
      value: `w${w.id}`,
      emoji: '⚠️',
    });
  }

  const dismiss = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CLEARWARN_PREFIX}:dismiss`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary),
  );
  const header = options.length ? `What should be lifted for <@${userId}>?` : `<@${userId}> has no warnings and is not banned.`;
  const components = options.length
    ? [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`${CLEARWARN_PREFIX}:pick:${userId}`).setPlaceholder('Pick a warning, or clear all').addOptions(options),
        ),
        dismiss,
      ]
    : [dismiss];
  return { content: note ? `${note}\n\n${header}` : header, components, allowedMentions: { parse: [] } };
}

/** The dropdown and the Dismiss button of the panel. */
export async function handleClearWarnComponent(interaction) {
  const [, action, userId] = interaction.customId.split(':');
  if (action === 'dismiss') {
    await interaction.deferUpdate();
    return interaction.deleteReply().catch(() => {});
  }
  if (!interaction.inGuild() || !(await isOwner(interaction))) {
    return interaction.reply({ content: 'Only the server owner can do this.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId));
  const value = interaction.values[0];
  const what = value === 'all' || value === 'ban' ? value : Number(value.slice(1));
  const note = await liftForUser(interaction.client, guild, userId, what, interaction.user, reasons.get(`${interaction.user.id}:${userId}`));
  return interaction.editReply(await clearPanel(guild, userId, note));
}
