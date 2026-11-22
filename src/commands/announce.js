import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import * as db from '../db.js';
import { resolveGuild } from '../lib/context.js';
import { broadcastGuide, isBroadcasting } from '../lib/guide.js';

export default {
  admin: true,
  manageOnly: true,
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('DM the how-to-use guide to server members (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addRoleOption((o) => o.setName('role').setDescription('Only members with this role (defaults to the /setup role)'))
    .addStringOption((o) => o.setName('role_id').setDescription('Role ID (use this in DMs, where the role picker is unavailable)'))
    .addBooleanOption((o) => o.setName('everyone').setDescription('Send to every member when no role is set'))
    .addStringOption((o) => o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, error } = await resolveGuild(interaction, { admin: true, manageOnly: true });
    if (error) return interaction.editReply(error);

    const cfg = db.getGuild(guild.id);
    if (!cfg?.channel_id) return interaction.editReply('Run `/setup channel` first so the guide can point somewhere.');
    if (isBroadcasting(guild.id)) return interaction.editReply('A broadcast is already running for this server.');

    const roleId =
      interaction.options.getRole('role')?.id ?? interaction.options.getString('role_id')?.trim() ?? cfg.role_id;
    let role = null;
    if (roleId) {
      role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) return interaction.editReply('I could not find that role.');
    } else if (!interaction.options.getBoolean('everyone')) {
      return interaction.editReply(
        'No role set. Set one with `/setup role`, pass a `role`, or pass `everyone: true` to DM every member.',
      );
    }

    const audience = role ? `members with **${role.name}**` : 'every member';
    await interaction.editReply(
      `Sending the guide to ${audience}. It is throttled (about 1 DM per 1.5s) to avoid Discord rate limits. I will DM you the result when done.`,
    );

    // Runs in the background: can outlast the 15 minute interaction window.
    broadcastGuide(guild, role)
      .then((s) =>
        interaction.user.send(`Guide broadcast for **${guild.name}** finished: ${s.sent} sent, ${s.failed} failed (DMs closed or blocked), ${s.total} targeted.`),
      )
      .catch((err) => {
        console.error('Broadcast failed:', err);
        interaction.user.send(`Guide broadcast for **${guild.name}** failed: ${err.message}`).catch(() => {});
      });
  },
};
