import { ApplicationCommandType, ContextMenuCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import * as db from '../db.js';
import { deleteConfessionMessage } from '../lib/confession.js';
import { userKey } from '../lib/identity.js';
import { modLog } from '../lib/moderation.js';

// Right-click your own submission -> Apps -> "Delete my submission". Only the author can, within the server's window
// (/setup options self_delete_minutes). Nobody learns who the author is: others just get "not yours".
export default {
  admin: false,
  data: new ContextMenuCommandBuilder()
    .setName('Delete my submission')
    .setType(ApplicationCommandType.Message)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const row = await db.getConfessionByMessage(interaction.guildId, interaction.targetId);
    if (!row) return reply('That message is not a submission I posted.');
    if (row.author_key !== userKey(interaction.guildId, interaction.user.id)) return reply('You can only delete your own submissions.');
    if (row.status === 'deleted') return reply('That submission is already deleted.');

    const minutes = (await db.getGuild(interaction.guildId))?.self_delete_minutes ?? 0;
    if (minutes <= 0) return reply('Deleting your own submissions is turned off in this server. Ask a moderator.');
    const left = (row.posted_at ?? row.created_at) + minutes * 60_000 - Date.now(); // counted from when it went up
    if (left <= 0) return reply(`You can only delete a submission within ${minutes} minute${minutes === 1 ? '' : 's'} of posting it. Ask a moderator.`);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId));
    await deleteConfessionMessage(guild, row);
    await modLog(guild, {
      title: 'Submission deleted by its author',
      id: row.id,
      subId: row.sub_id,
      number: row.number,
      content: row.content,
      hasImage: Boolean(row.has_image),
      authorId: row.author_id || null,
    });
    return interaction.editReply('Your submission was deleted.');
  },
};
