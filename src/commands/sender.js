import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, MessageFlags } from 'discord.js';
import * as db from '../db.js';
import { hasPin, isOwner, promptPin } from '../lib/owner-pin.js';

// Owner-only: reveal who sent a submission. Asks for the owner PIN first (60 seconds), answers only to the owner.
export default {
  admin: true,
  data: new SlashCommandBuilder()
    .setName('sender')
    .setDescription('Show the sender ID of a submission (server owner only, needs your PIN)')
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addIntegerOption((o) => o.setName('id').setDescription('Submission ID (the title of the mod log entry)').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const no = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!(await isOwner(interaction))) return no('Only the server owner can look up sender IDs.');
    if (!hasPin(interaction.guildId)) return no('You have no PIN yet. Run `/ownerpin` to set one, then try again.');
    const subId = interaction.options.getInteger('id', true);
    if (!db.getConfessionBySubId(interaction.guildId, subId)) return no(`There is no submission with ID \`${subId}\` in this server.`);
    return promptPin(interaction, 'sender', { subId });
  },
};
