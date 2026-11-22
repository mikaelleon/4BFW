import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
  time,
} from 'discord.js';
import * as db from '../db.js';
import { resolveGuild } from '../lib/context.js';
import { banAuthor, deleteSubmission, unbanAuthor, warnAuthor } from '../lib/actions.js';
import { COLOR, anonRef } from '../lib/format.js';

// `id` is the admin-only Submission ID (unique forever). The public number can repeat after a counter reset.
const idOpt = (o) =>
  o.setName('id').setDescription('Submission ID (admin-only; see the mod log or right-click the message)').setRequired(true).setMinValue(1);
const reasonOpt = (o) => o.setName('reason').setDescription('Reason (sent to the author, shown in the mod log)').setMaxLength(500);
const serverOpt = (o) => o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true);

export default {
  admin: true, // Manage Server or the moderator role (/setup modrole)
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderate anonymous submissions (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addSubcommand((s) =>
      s.setName('delete').setDescription('Delete a submission').addIntegerOption(idOpt).addStringOption(reasonOpt).addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('warn')
        .setDescription('Warn the author of a submission')
        .addIntegerOption(idOpt)
        .addStringOption(reasonOpt)
        .addBooleanOption((o) => o.setName('delete').setDescription('Also delete the submission'))
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('ban')
        .setDescription('Ban the author of a submission from posting')
        .addIntegerOption(idOpt)
        .addStringOption(reasonOpt)
        .addBooleanOption((o) => o.setName('delete').setDescription('Also delete the submission (default: yes)'))
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('unban')
        .setDescription("Lift the ban on a submission's author")
        .addIntegerOption(idOpt)
        .addBooleanOption((o) => o.setName('clear_warnings').setDescription('Also reset their warnings (default: yes)'))
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s.setName('info').setDescription('Status of a submission and its author').addIntegerOption(idOpt).addStringOption(serverOpt),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, error } = await resolveGuild(interaction, { admin: true });
    if (error) return interaction.editReply(error);

    const sub = interaction.options.getSubcommand();
    const id = interaction.options.getInteger('id', true);
    const row = db.getConfession(guild.id, id);
    if (!row) return interaction.editReply(`There is no submission with ID \`${id}\` in this server.`);

    const actor = interaction.user;
    const reason = interaction.options.getString('reason');
    const client = interaction.client;

    if (sub === 'info') {
      const cfg = db.getGuild(guild.id);
      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`Submission ID ${id}`)
        .addFields(
          { name: 'Public number', value: anonRef(row.number), inline: true },
          { name: 'Status', value: row.status, inline: true },
          { name: 'Posted', value: time(Math.floor(row.created_at / 1000), 'R'), inline: true },
          { name: "Author's warnings", value: `${db.countWarnings(guild.id, row.author_id)}/${cfg.warn_limit}`, inline: true },
          { name: 'Author banned', value: db.getBan(guild.id, row.author_id) ? 'Yes' : 'No', inline: true },
        );
      if (row.channel_id && row.message_id) {
        embed.setDescription(`[Jump to message](https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id})`);
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'delete') return interaction.editReply(await deleteSubmission(guild, row, actor, reason));
    if (sub === 'warn') {
      const alsoDelete = interaction.options.getBoolean('delete') ?? false;
      return interaction.editReply(await warnAuthor(client, guild, row, actor, reason, { alsoDelete }));
    }
    if (sub === 'ban') {
      const alsoDelete = interaction.options.getBoolean('delete') ?? true;
      return interaction.editReply(await banAuthor(client, guild, row, actor, reason, { alsoDelete }));
    }
    const clearWarnings = interaction.options.getBoolean('clear_warnings') ?? true;
    return interaction.editReply(await unbanAuthor(client, guild, row, actor, { clearWarnings }));
  },
};
