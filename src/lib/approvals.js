// Approve / Reject buttons on a submission that is waiting in the mod log (approval mode or held by the filter).
import { EmbedBuilder, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import * as db from '../db.js';
import { APPROVAL_PREFIX, approveSubmission, rejectSubmission } from './confession.js';
import { isModerator } from './context.js';
import { PRESET_ID, combineReason, reasonDropdown } from './reasons.js';

export const APPROVAL_REASON_PREFIX = 'approvalreason'; // modal "approvalreason:<confession id>"
const EPHEMERAL = MessageFlags.Ephemeral;

function guard(interaction, idText) {
  const deny = (content) => interaction.reply({ content, flags: EPHEMERAL }).catch(() => {});
  if (!interaction.inGuild() || !isModerator(interaction.member, interaction.memberPermissions, db.getGuild(interaction.guildId))) {
    deny('Only moderators can review submissions.');
    return null;
  }
  const row = db.getConfession(interaction.guildId, Number(idText));
  if (!row) {
    deny('That submission no longer exists.');
    return null;
  }
  if (row.status !== 'pending') {
    deny(`That submission was already handled (${row.status}).`);
    return null;
  }
  return row;
}

/** Strip the buttons off the log entry and record who decided. */
function resolvedEntry(interaction, outcome) {
  const embed = EmbedBuilder.from(interaction.message.embeds[0]).addFields({ name: 'Outcome', value: `${outcome} by <@${interaction.user.id}>` });
  return { embeds: [embed], components: [] };
}

/** Approve acts at once; Reject asks for a reason first. */
export async function handleApprovalButton(interaction) {
  const [, action, idText] = interaction.customId.split(':');
  const row = guard(interaction, idText);
  if (!row) return;

  if (action === 'no') {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${APPROVAL_REASON_PREFIX}:${row.id}`)
        .setTitle(`Reject submission ${row.sub_id}`)
        .addLabelComponents(
          reasonDropdown('delete'),
          new LabelBuilder().setLabel('Details (optional)').setTextInputComponent(
            new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setMaxLength(400).setRequired(false),
          ),
        ),
    );
  }

  await interaction.deferUpdate();
  const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId));
  const res = await approveSubmission(guild, row, interaction.user);
  if (!res.ok) return interaction.followUp({ content: res.error, flags: EPHEMERAL }).catch(() => {});
  await interaction.editReply(resolvedEntry(interaction, res.scheduled ? 'Approved, posts when posting resumes,' : 'Approved')).catch(() => {});
}

export async function handleApprovalModal(interaction) {
  const row = guard(interaction, interaction.customId.split(':')[1]);
  if (!row) return;
  await interaction.deferUpdate();
  const reason = combineReason(interaction.fields.getStringSelectValues(PRESET_ID)[0], interaction.fields.getTextInputValue('reason'));
  const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId));
  const res = await rejectSubmission(guild, row, interaction.user, reason);
  if (!res.ok) return interaction.followUp({ content: res.error, flags: EPHEMERAL }).catch(() => {});
  await interaction.editReply(resolvedEntry(interaction, 'Rejected')).catch(() => {});
}

export { APPROVAL_PREFIX };
