// Appeals: a warned user contests a warning with /appeal W-0042; moderators overturn or uphold it from the log entry.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import * as db from '../db.js';
import { isModerator } from './context.js';
import { userKey } from './identity.js';
import { dmUser, modLog, notice } from './moderation.js';
import { parseWarningCode, warningCode } from './notices.js';

export const APPEAL_PREFIX = 'appeal'; // buttons "appeal:<overturn|uphold>:<warning id>"

const EPHEMERAL = MessageFlags.Ephemeral;

function appealRow(warningId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${APPEAL_PREFIX}:overturn:${warningId}`).setLabel('Overturn warning').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${APPEAL_PREFIX}:uphold:${warningId}`).setLabel('Uphold').setStyle(ButtonStyle.Secondary),
  );
}

/** /appeal handler. Returns the text to show the user. Never reveals anything about other users. */
export async function submitAppeal(interaction) {
  const warningId = parseWarningCode(interaction.options.getString('warning', true));
  const warning = warningId ? db.getWarning(warningId) : null;
  // Same answer for "does not exist" and "is not yours", so IDs cannot be probed.
  if (!warning || warning.user_id !== userKey(warning.guild_id, interaction.user.id)) {
    return 'I could not find that warning on your account. Use the ID from the warning DM, like `W-0042`.';
  }

  const guild = interaction.client.guilds.cache.get(warning.guild_id);
  if (!guild) return 'I can no longer reach that server.';

  const existing = db.getAppeal(warningId);
  if (existing) {
    return existing.status === 'open'
      ? 'You already appealed this warning. A moderator will review it and I will DM you the result.'
      : `This warning was already reviewed (${existing.status}).`;
  }

  const cfg = db.getGuild(guild.id);
  if (!cfg?.log_channel_id) {
    return 'This server has no moderation log set up, so I cannot pass your appeal on. Message a moderator of the server directly.';
  }

  const message = interaction.options.getString('message')?.trim() || null;
  const row = warning.confession_id ? db.getConfession(guild.id, warning.confession_id) : null;
  db.addAppeal(warningId, guild.id, interaction.user.id, message);

  const fields = [
    { name: 'Warning ID', value: warningCode(warningId), inline: true },
    { name: 'Warned for', value: (warning.reason ?? 'No reason given').slice(0, 1000) },
  ];
  if (message) fields.push({ name: 'Appeal message', value: message });
  await modLog(guild, {
    title: 'Warning appeal',
    id: row?.id,
    subId: row?.sub_id,
    number: row?.number ?? 0,
    content: row?.content,
    hasImage: Boolean(row?.has_image),
    authorId: interaction.user.id,
    fields,
    components: [appealRow(warningId)],
    ping: cfg.mod_role_id,
  });
  return 'Appeal sent. A moderator will review it, and I will DM you the result.';
}

/** Overturn / Uphold buttons on an appeal entry. */
export async function handleAppealButton(interaction) {
  const [, action, idText] = interaction.customId.split(':');
  const warningId = Number(idText);
  const deny = (content) => interaction.reply({ content, flags: EPHEMERAL });

  if (!interaction.inGuild() || !isModerator(interaction.member, interaction.memberPermissions, db.getGuild(interaction.guildId))) {
    return deny('Only moderators can review appeals.');
  }
  const appeal = db.getAppeal(warningId);
  if (!appeal || appeal.guild_id !== interaction.guildId) return deny('That appeal no longer exists.');
  if (appeal.status !== 'open') return deny(`That appeal was already ${appeal.status}.`);

  await interaction.deferUpdate();
  const overturn = action === 'overturn';
  if (overturn) db.deleteWarning(warningId);
  db.resolveAppeal(warningId, overturn ? 'overturned' : 'upheld', interaction.user.id);

  const { guild, client } = interaction;
  const code = warningCode(warningId);
  await dmUser(
    client,
    appeal.user_id,
    notice(
      `Appeal ${overturn ? 'accepted' : 'reviewed'} in ${guild.name}`,
      overturn
        ? `Your appeal of warning **${code}** was accepted, and the warning has been removed.`
        : `Your appeal of warning **${code}** was reviewed, and the warning stands. Please keep the rules in mind.`,
    ),
  );

  const embed = EmbedBuilder.from(interaction.message.embeds[0]).addFields({
    name: 'Outcome',
    value: `${overturn ? 'Overturned' : 'Upheld'} by <@${interaction.user.id}>`,
  });
  await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
  await interaction
    .followUp({
      content: overturn
        ? 'Warning removed and the user was notified. If it caused a ban, lift that separately with Unban or `/mod unban`.'
        : 'Appeal upheld and the user was notified.',
      flags: EPHEMERAL,
    })
    .catch(() => {});
}
