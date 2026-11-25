import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, MessageFlags } from 'discord.js';
import { resolveGuild } from '../lib/context.js';
import { submitConfession, MAX_LEN } from '../lib/confession.js';
import { anonTitle } from '../lib/format.js';
import { prepareImage, uploadLimit } from '../lib/image.js';
import { parsePollOptions } from '../lib/engagement.js';
import { tagChoices } from '../lib/tags.js';

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
    .addStringOption((o) => o.setName('topic').setDescription('Topic of your post (optional)').addChoices(...tagChoices()))
    .addStringOption((o) =>
      o.setName('poll').setDescription('Make it a poll: 2-5 options separated by | (your message is the question)').setMaxLength(250),
    )
    .addAttachmentOption((o) => o.setName('image').setDescription('Optional image (PNG, JPG, GIF or WEBP)'))
    .addStringOption((o) =>
      o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true),
    ),

  async execute(interaction) {
    // Ephemeral: nobody else ever sees that you used the command or the reply.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, error } = await resolveGuild(interaction);
    if (error) return interaction.editReply(error);

    const poll = parsePollOptions(interaction.options.getString('poll'), '|');
    if (poll.error) return interaction.editReply(poll.error);

    let image = null;
    const attachment = interaction.options.getAttachment('image');
    if (attachment) {
      const prepared = await prepareImage(attachment, uploadLimit(guild));
      if (prepared.error) return interaction.editReply(prepared.error);
      image = prepared.image;
    }

    const res = await submitConfession(guild, interaction.user.id, interaction.options.getString('message', true), null, image, {
      tag: interaction.options.getString('topic'),
      pollOptions: poll.options,
    });
    return interaction.editReply(res.ok ? `Posted as **${anonTitle(res.number)}**.\n${res.url}` : res.error);
  },
};
