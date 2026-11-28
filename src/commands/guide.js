import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, MessageFlags } from 'discord.js';
import { resolveGuild } from '../lib/context.js';
import { guidePayload } from '../lib/guide.js';

export default {
  admin: false,
  data: new SlashCommandBuilder()
    .setName('guide')
    .setDescription('Show how to use the STFW bot')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addStringOption((o) =>
      o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, error } = await resolveGuild(interaction);
    if (error) return interaction.editReply(error);
    return interaction.editReply(guidePayload(guild, 0));
  },
};
