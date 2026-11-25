// Appeals: a warned user contests a warning with /appeal W-0042; moderators overturn or uphold it from the log entry.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as db from '../db.js';
import { MAX_APPEAL_LEN, submitBanAppeal } from './ban-appeals.js';
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
export function submitAppeal(interaction) {
  return fileWarningAppeal(
    interaction.client,
    interaction.user,
    parseWarningCode(interaction.options.getString('warning', true)),
    interaction.options.getString('message')?.trim() || null,
  );
}

/** Core of both the /appeal command and the appeal form. Returns the text to show the user. */
async function fileWarningAppeal(client, user, warningId, message) {
  const warning = warningId ? db.getWarning(warningId) : null;
  // Same answer for "does not exist" and "is not yours", so IDs cannot be probed.
  if (!warning || warning.user_id !== userKey(warning.guild_id, user.id)) {
    return 'I could not find that warning on your account. Use the ID from the warning DM, like `W-0042`.';
  }

  const guild = client.guilds.cache.get(warning.guild_id);
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

  const row = warning.confession_id ? db.getConfession(guild.id, warning.confession_id) : null;
  db.addAppeal(warningId, guild.id, user.id, message);

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
    authorId: user.id,
    fields,
    components: [appealRow(warningId)],
    ping: cfg.mod_role_id,
  });
  return 'Appeal sent. A moderator will review it, and I will DM you the result.';
}

/* ---------- the appeal form: "Appeal" button in a warning / ban DM -> dropdown -> pop-up with a required text box ---------- */

export const APPEAL_PICK_PREFIX = 'appealpick'; // dropdown "appealpick:<guildId>"
export const APPEAL_MODAL_PREFIX = 'appealmodal'; // pop-up "appealmodal:<guildId>:<w<warning id> | ban>"

const clip = (text, max) => ((text ?? '').length > max ? `${text.slice(0, max - 1)}…` : (text ?? ''));

/** Button: list what this user can appeal in that server (open warnings, a ban) as a dropdown. */
export async function handleAppealFormButton(interaction) {
  const guildId = interaction.customId.split(':')[1];
  const guild = interaction.client.guilds.cache.get(guildId);
  if (!guild) return interaction.reply({ content: 'I can no longer reach that server.', flags: EPHEMERAL });

  const options = [];
  const ban = db.getBan(guildId, interaction.user.id);
  const banAppeal = db.latestBanAppeal(guildId, interaction.user.id);
  if (ban && banAppeal?.status !== 'open') {
    options.push({ label: 'Posting ban', description: clip(ban.reason ?? 'No reason given', 100), value: 'ban', emoji: '🚫' });
  }
  for (const w of db.listWarnings(guildId, interaction.user.id)) {
    if (w.expired || db.getAppeal(w.id)) continue; // expired ones no longer count; one appeal per warning
    const post = w.confession_id ? db.getConfession(guildId, w.confession_id) : null;
    options.push({
      label: `${warningCode(w.id)} · Warning${post?.number ? ` on #${String(post.number).padStart(3, '0')}` : ''}`,
      description: clip(w.reason ?? 'No reason given', 100),
      value: `w${w.id}`,
      emoji: '⚠️',
    });
  }
  if (!options.length) {
    return interaction.reply({ content: `You have nothing to appeal in **${guild.name}** right now (appeals already sent are waiting for a moderator).`, flags: EPHEMERAL });
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${APPEAL_PICK_PREFIX}:${guildId}`)
    .setPlaceholder('What are you appealing?')
    .addOptions(options.slice(0, 25));
  return interaction.reply({
    content: `What do you want to appeal in **${guild.name}**?`,
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: EPHEMERAL,
  });
}

/** Dropdown: open the pop-up asking why. The text box is required. */
export function handleAppealPick(interaction) {
  const guildId = interaction.customId.split(':')[1];
  return interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${APPEAL_MODAL_PREFIX}:${guildId}:${interaction.values[0]}`)
      .setTitle('Appeal')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Why should this be reversed?')
          .setDescription('A moderator will read this and I will DM you the result.')
          .setTextInputComponent(
            new TextInputBuilder().setCustomId('why').setStyle(TextInputStyle.Paragraph).setMinLength(5).setMaxLength(MAX_APPEAL_LEN).setRequired(true),
          ),
      ),
  );
}

/** Pop-up submitted: send the appeal to the mod log (warning appeal or ban appeal). */
export async function handleAppealModal(interaction) {
  const [, guildId, what] = interaction.customId.split(':');
  await interaction.deferReply({ flags: EPHEMERAL });
  const why = interaction.fields.getTextInputValue('why').trim();
  if (!why) return interaction.editReply('Write why you are appealing.');
  if (what === 'ban') {
    const guild = interaction.client.guilds.cache.get(guildId);
    if (!guild) return interaction.editReply('I can no longer reach that server.');
    return interaction.editReply(await submitBanAppeal(guild, interaction.user, why));
  }
  const warningId = Number(what.slice(1));
  const warning = db.getWarning(warningId);
  if (!warning || warning.guild_id !== guildId) return interaction.editReply('I could not find that warning on your account.');
  return interaction.editReply(await fileWarningAppeal(interaction.client, interaction.user, warningId, why));
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
