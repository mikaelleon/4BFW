// Interaction handlers for the moderation buttons under each mod-log entry.
import { LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import * as db from '../db.js';
import { banAuthor, deleteSubmission, restoreSubmission, unbanAuthor, warnAuthor } from './actions.js';
import { parseDuration } from './duration.js';
import { PRESET_ID, combineReason, reasonDropdown } from './reasons.js';
import { isModerator } from './context.js';
import { controlsRow } from './controls-row.js';
import { anonRef } from './format.js';

export const REASON_PREFIX = 'modreason'; // modal: "modreason:<action>:<submission id>"

const TITLES = { warn: 'Warn author', delete: 'Delete submission', ban: 'Ban author' };
const EPHEMERAL = MessageFlags.Ephemeral;

async function guard(interaction) {
  if (!interaction.inGuild() || !isModerator(interaction.member, interaction.memberPermissions, await db.getGuild(interaction.guildId))) {
    interaction.reply({ content: 'Only moderators can use these controls.', flags: EPHEMERAL }).catch(() => {});
    return null;
  }
  const [, action, idText] = interaction.customId.split(':');
  const row = await db.getConfession(interaction.guildId, Number(idText));
  if (!row) {
    interaction.reply({ content: 'That submission no longer exists.', flags: EPHEMERAL }).catch(() => {});
    return null;
  }
  return { action, row };
}

/** Refresh the buttons on the log entry (Delete greys out, Ban/Unban swaps) and tell the moderator what happened. */
async function finish(interaction, row, text) {
  const fresh = await db.getConfession(interaction.guildId, row.id);
  const banned = Boolean(await db.getBan(interaction.guildId, fresh.author_key));
  await interaction.editReply({ components: [controlsRow(fresh, banned)] }).catch(() => {});
  await interaction.followUp({ content: text, flags: EPHEMERAL }).catch(() => {});
}

/** A button was pressed: Unban acts right away, the others ask for an optional reason first. */
export async function handleControlButton(interaction) {
  const found = await guard(interaction);
  if (!found) return;
  const { action, row } = found;

  if (action === 'unban') {
    await interaction.deferUpdate();
    const text = await unbanAuthor(interaction.client, interaction.guild, row, interaction.user);
    return finish(interaction, row, text);
  }
  if (action === 'restore') {
    await interaction.deferUpdate();
    const text = await restoreSubmission(interaction.guild, row, interaction.user);
    return finish(interaction, row, text);
  }
  if (!TITLES[action]) return interaction.reply({ content: 'Unknown action.', flags: EPHEMERAL });

  const modal = new ModalBuilder()
    .setCustomId(`${REASON_PREFIX}:${action}:${row.id}`)
    .setTitle(`${TITLES[action]} ${anonRef(row.number)}`)
    .addLabelComponents(
      reasonDropdown(action), // preset reasons at the top
      new LabelBuilder().setLabel('Details (optional)').setTextInputComponent(
        new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setMaxLength(400).setRequired(false),
      ),
    );
  if (action === 'ban') {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Duration (empty = permanent)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('duration')
            .setPlaceholder('30m, 12h, 7d, 2w')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(8)
            .setRequired(false),
        ),
    );
  }
  return interaction.showModal(modal);
}

/** The reason modal was submitted: run the action. */
export async function handleReasonModal(interaction) {
  const found = await guard(interaction);
  if (!found) return;
  const { action, row } = found;

  let durationMs = null;
  if (action === 'ban') {
    const parsed = parseDuration(interaction.fields.getTextInputValue('duration'));
    if (parsed.error) return interaction.reply({ content: parsed.error, flags: EPHEMERAL });
    durationMs = parsed.ms;
  }

  await interaction.deferUpdate();
  const reason = combineReason(interaction.fields.getStringSelectValues(PRESET_ID)[0], interaction.fields.getTextInputValue('reason'));
  const { client, guild, user } = interaction;

  let text;
  if (action === 'warn') text = await warnAuthor(client, guild, row, user, reason);
  else if (action === 'delete') text = await deleteSubmission(guild, row, user, reason);
  else if (action === 'ban') text = await banAuthor(client, guild, row, user, reason, { durationMs });
  else text = 'Unknown action.';
  return finish(interaction, row, text);
}
