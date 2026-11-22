import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, MessageFlags } from 'discord.js';
import { resolveGuild } from '../lib/context.js';
import { submitConfession, MAX_LEN } from '../lib/confession.js';
import { anonTitle } from '../lib/format.js';

export default {
  admin: false,
  data: new SlashCommandBuilder()
    .setName('fw')
    .setDescription('Send an anonymous submission to the freedom wall')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addStringOption((o) =>
      o.setName('message').setDescription('What you want to say').setRequired(true).setMaxLength(MAX_LEN),
    )
    .addStringOption((o) =>
      o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true),
    ),

  async execute(interaction) {
    // Ephemeral: nobody else ever sees that you used the command or the reply.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, error } = await resolveGuild(interaction);
    if (error) return interaction.editReply(error);

    const res = await submitConfession(guild, interaction.user.id, interaction.options.getString('message', true));
    return interaction.editReply(res.ok ? `Posted as **${anonTitle(res.number)}**.\n${res.url}` : res.error);
  },
};
