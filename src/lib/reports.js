// "Report" button under each submission. Reports are anonymous: the mod log only ever shows a count and the optional
// reason, never who reported. The reporter id is stored once per post just so nobody can report twice.
import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import * as db from '../db.js';
import { hideConfessionMessage } from './confession.js';
import { anonRef, anonTitle } from './format.js';
import { modLog } from './moderation.js';

export const REPORT_MODAL_PREFIX = 'confess:reportmodal'; // "confess:reportmodal:<message id>"
const EPHEMERAL = MessageFlags.Ephemeral;

const reply = (interaction, content) => interaction.reply({ content, flags: EPHEMERAL });

/** The Report button was pressed: ask for an optional reason. */
export async function handleReportButton(interaction) {
  if (!interaction.inGuild()) return reply(interaction, 'Use this button inside a server.');
  const target = db.getConfessionByMessage(interaction.guildId, interaction.message.id);
  if (!target || target.status !== 'posted') return reply(interaction, 'That submission is no longer available to report.');
  if (db.hasReported(target.id, interaction.user.id)) return reply(interaction, 'You already reported this submission. The moderators have been told.');

  const modal = new ModalBuilder()
    .setCustomId(`${REPORT_MODAL_PREFIX}:${interaction.message.id}`)
    .setTitle(`Report ${anonTitle(target.number)}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('What is wrong with it? (optional)')
          .setPlaceholder('Your name is never shown to the moderators.')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(false),
      ),
    );
  return interaction.showModal(modal);
}

/** The report form was submitted: count it, tell the moderators, and hide the post at the server's limit. */
export async function handleReportModal(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId));
  const messageId = interaction.customId.split(':')[2];
  const target = db.getConfessionByMessage(guild.id, messageId);
  if (!target || target.status !== 'posted') return interaction.editReply('That submission is no longer available to report.');

  const reason = interaction.fields.getTextInputValue('reason').trim() || null;
  if (!db.addReport(target.id, interaction.user.id, reason)) return interaction.editReply('You already reported this submission.');

  const cfg = db.getGuild(guild.id);
  const count = db.countReports(target.id);
  const limit = cfg.report_limit ?? 0;
  const hide = limit > 0 && count >= limit;
  const base = {
    id: target.id,
    number: target.number,
    content: target.content,
    hasImage: Boolean(target.has_image),
    authorId: target.author_id,
    url: `https://discord.com/channels/${guild.id}/${target.channel_id}/${target.message_id}`,
    reason,
    controls: true,
  };

  // Ping the moderators on the first report and when the post gets hidden; the ones in between are quiet.
  const ping = count === 1 && !hide ? cfg.mod_role_id : null;
  const counter = limit > 0 ? `${count}/${limit}` : `${count}`;
  await modLog(guild, { ...base, title: `Submission reported (${counter})`, ping }).catch(() => {});

  if (hide) {
    const fresh = db.getConfession(guild.id, target.id);
    if (fresh.status === 'posted') {
      const hidden = await hideConfessionMessage(guild, fresh).catch((err) => {
        console.error('Auto-hide failed:', err);
        return false;
      });
      if (hidden) {
        // The status is 'hidden' by now, so this entry's buttons include Restore.
        await modLog(guild, {
          ...base,
          title: `Submission auto-hidden (${count} reports)`,
          reason: `Reached the report limit (${limit}). Restore it to dismiss the reports, or delete / warn / ban.`,
          ping: cfg.mod_role_id,
        }).catch(() => {});
      }
    }
  }
  return interaction.editReply(`Thanks. ${anonRef(target.number)} was reported and the moderators were told. Nobody sees that it was you.`);
}
