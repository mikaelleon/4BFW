// Ban appeals: a banned author DMs `fw appeal <why>`; the mod log gets the appeal with Lift / Deny buttons.
// (Warning appeals are separate: /appeal W-0042, see appeals.js.)
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import * as db from '../db.js';
import { candidateGuilds, isModerator } from './context.js';
import { untilTag } from './duration.js';
import { prefix } from './format.js';
import { dmUser, modLog, notice } from './moderation.js';

export const BAN_APPEAL_PREFIX = 'banappeal'; // buttons "banappeal:<lift|deny>:<appeal id>"
export const MAX_APPEAL_LEN = 900;
const RETRY_AFTER_MS = 7 * 86_400_000; // after a denial the user waits a week before appealing again
const EPHEMERAL = MessageFlags.Ephemeral;

export const appealUsage = () => `To appeal your ban, send:\n\`${prefix()} appeal <why it should be lifted>\``;

/** Servers (set up, user is a member) where this user is currently banned. */
export async function bannedGuildsOf(client, userId) {
  const guilds = await candidateGuilds(client, userId);
  return guilds.filter((g) => db.getBan(g.id, userId));
}

const appealRow = (id) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${BAN_APPEAL_PREFIX}:lift:${id}`).setLabel('Lift ban').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${BAN_APPEAL_PREFIX}:deny:${id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );

/** Send the appeal to the mod log. Returns the text to DM back to the user. */
export async function submitBanAppeal(guild, user, text) {
  const ban = db.getBan(guild.id, user.id);
  if (!ban) return `You are not banned in **${guild.name}**, so there is nothing to appeal.`;
  if (text.length > MAX_APPEAL_LEN) return `That is too long. Keep it under ${MAX_APPEAL_LEN} characters.`;

  const last = db.latestBanAppeal(guild.id, user.id);
  if (last?.status === 'open') return 'You already appealed this ban. A moderator will review it and I will DM you the result.';
  if (last?.status === 'denied' && Date.now() - last.resolved_at < RETRY_AFTER_MS) {
    return `Your last appeal was denied. You can appeal again <t:${Math.floor((last.resolved_at + RETRY_AFTER_MS) / 1000)}:R>.`;
  }

  const cfg = db.getGuild(guild.id);
  if (!cfg?.log_channel_id) return 'This server has no moderation log set up, so I cannot pass your appeal on. Message a moderator directly.';

  const id = db.addBanAppeal(guild.id, user.id, text);
  await modLog(guild, {
    title: 'Ban appeal',
    authorId: user.id,
    fields: [
      { name: 'Banned', value: ban.expires_at ? `Until ${untilTag(ban.expires_at)}` : 'Permanent', inline: true },
      { name: 'Ban reason', value: (ban.reason ?? 'No reason given').slice(0, 1000) },
      { name: 'Appeal', value: text },
    ],
    components: [appealRow(id)],
    ping: cfg.mod_role_id,
  });
  return 'Appeal sent. A moderator will review it, and I will DM you the result.';
}

/** Lift / Deny buttons on an appeal entry in the mod log. */
export async function handleBanAppealButton(interaction) {
  const [, action, idText] = interaction.customId.split(':');
  const deny = (content) => interaction.reply({ content, flags: EPHEMERAL });

  if (!interaction.inGuild() || !isModerator(interaction.member, interaction.memberPermissions, db.getGuild(interaction.guildId))) {
    return deny('Only moderators can review appeals.');
  }
  const appeal = db.getBanAppeal(Number(idText));
  if (!appeal || appeal.guild_id !== interaction.guildId) return deny('That appeal no longer exists.');
  if (appeal.status !== 'open') return deny(`That appeal was already ${appeal.status}.`);

  await interaction.deferUpdate();
  const lift = action === 'lift';
  const { guild, client, user } = interaction;
  const dmId = appeal.dm_id; // cleared by resolveBanAppeal, so read it first

  let note = '';
  if (lift) {
    // Same as /mod unban: the ban goes and the warnings reset, so the next slip does not instantly re-ban.
    const wasBanned = db.unbanUser(guild.id, appeal.user_key);
    db.clearWarnings(guild.id, appeal.user_key);
    if (!wasBanned) note = ' (they were no longer banned)';
  }
  db.resolveBanAppeal(appeal.id, lift ? 'lifted' : 'denied', user.id);

  await dmUser(
    client,
    dmId,
    notice(
      lift ? `Ban lifted in ${guild.name}` : `Appeal denied in ${guild.name}`,
      lift
        ? 'A moderator accepted your appeal and lifted your ban. You can post again. Please follow the rules.'
        : `Your appeal was reviewed and the ban stands. You can appeal again in 7 days with \`${prefix()} appeal <why>\`.`,
    ),
  );

  const embed = EmbedBuilder.from(interaction.message.embeds[0]).addFields({
    name: 'Outcome',
    value: `${lift ? 'Ban lifted' : 'Denied'} by <@${user.id}>${note}`,
  });
  await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
}
