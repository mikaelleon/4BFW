import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, MessageFlags } from 'discord.js';
import { isOwner, promptPin } from '../lib/owner-pin.js';

// Owner-only: set or change the 6-digit PIN that /sender asks for. Needs the current PIN when one exists.
export default {
  admin: true,
  data: new SlashCommandBuilder()
    .setName('ownerpin')
    .setDescription('Set or change your owner PIN (server owner only)')
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

  async execute(interaction) {
    if (!(await isOwner(interaction))) {
      return interaction.reply({ content: 'Only the server owner can change the PIN.', flags: MessageFlags.Ephemeral });
    }
    return promptPin(interaction, 'change');
  },
};
