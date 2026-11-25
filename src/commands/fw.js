import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, MessageFlags } from 'discord.js';
import * as db from '../db.js';
import { resolveGuild } from '../lib/context.js';
import { MAX_LEN } from '../lib/confession.js';
import { resultText, submitOrPreview } from '../lib/drafts.js';
import { prepareImage, uploadLimit } from '../lib/image.js';
import { parsePollOptions } from '../lib/engagement.js';
import { MAX_CW_LEN } from '../lib/render.js';
import { tagChoices } from '../lib/tags.js';

const onOff = [
  { name: 'On', value: 'on' },
  { name: 'Off', value: 'off' },
];

export default {
  admin: false,
  data: new SlashCommandBuilder()
    .setName('fw')
    .setDescription('Send an anonymous submission to the freedom wall')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addStringOption((o) => o.setName('message').setDescription('What you want to say').setMaxLength(MAX_LEN))
    .addStringOption((o) => o.setName('topic').setDescription('Topic of your post (optional)').addChoices(...tagChoices()))
    .addStringOption((o) =>
      o.setName('cw').setDescription('Content warning: hides your text behind a spoiler, e.g. "violence"').setMaxLength(MAX_CW_LEN),
    )
    .addStringOption((o) =>
      o.setName('poll').setDescription('Make it a poll: 2-5 options separated by | (your message is the question)').setMaxLength(250),
    )
    .addIntegerOption((o) => o.setName('poll_hours').setDescription('Close the poll after this many hours (default: the server setting)').setMinValue(1).setMaxValue(168))
    .addAttachmentOption((o) => o.setName('image').setDescription('Optional image (PNG, JPG, GIF or WEBP)'))
    .addStringOption((o) =>
      o.setName('notify').setDescription('DM me when someone replies to my posts (use this alone to change it)').addChoices(...onOff),
    )
    .addStringOption((o) =>
      o.setName('preview').setDescription('Show me a preview and ask before posting (use this alone to change it)').addChoices(...onOff),
    )
    .addStringOption((o) =>
      o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true),
    ),

  async execute(interaction) {
    // Ephemeral: nobody else ever sees that you used the command or the reply.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Personal settings first: they work on their own, without a message.
    const notes = [];
    const notify = interaction.options.getString('notify');
    const preview = interaction.options.getString('preview');
    if (notify) {
      db.setPref(interaction.user.id, 'notify_off', notify === 'off');
      notes.push(notify === 'off' ? 'Reply notifications are **off**: I will not DM you when someone replies to your posts.' : 'Reply notifications are **on**.');
    }
    if (preview) {
      db.setPref(interaction.user.id, 'preview', preview === 'on');
      notes.push(preview === 'on' ? 'Previews are **on**: I will show you the post and ask before it goes up.' : 'Previews are **off**.');
    }

    const message = interaction.options.getString('message');
    const attachment = interaction.options.getAttachment('image');
    if (!message && !attachment) {
      return interaction.editReply(notes.length ? notes.join('\n') : 'Write a `message` (or attach an `image`) to post.');
    }

    const { guild, error } = await resolveGuild(interaction);
    if (error) return interaction.editReply([...notes, error].join('\n'));

    const poll = parsePollOptions(interaction.options.getString('poll'), '|');
    if (poll.error) return interaction.editReply(poll.error);

    let image = null;
    if (attachment) {
      const prepared = await prepareImage(attachment, uploadLimit(guild));
      if (prepared.error) return interaction.editReply(prepared.error);
      image = prepared.image;
    }

    const out = await submitOrPreview(guild, interaction.user.id, message ?? '', null, image, {
      tag: interaction.options.getString('topic'),
      cw: interaction.options.getString('cw'),
      pollOptions: poll.options,
      pollHours: interaction.options.getInteger('poll_hours'),
    });
    if (out.preview) return interaction.editReply({ ...out.preview, content: [...notes, out.preview.content].join('\n') });
    return interaction.editReply([...notes, resultText(out.result, guild, { inGuildName: !interaction.inGuild(), url: true })].join('\n'));
  },
};
