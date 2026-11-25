import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, MessageFlags } from 'discord.js';
import { submitAppeal } from '../lib/appeals.js';

export default {
  admin: false,
  data: new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Contest a warning you received')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addStringOption((o) =>
      o.setName('warning').setDescription('The warning ID from your DM, like W-0042').setRequired(true).setMaxLength(12),
    )
    .addStringOption((o) =>
      o.setName('message').setDescription('Why you think it was a mistake (optional)').setMaxLength(500),
    ),

  async execute(interaction) {
    // Ephemeral: nobody else sees that you appealed.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(await submitAppeal(interaction));
  },
};
