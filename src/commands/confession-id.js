import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import * as db from '../db.js';
import { anonRef } from '../lib/format.js';
import { isModerator } from '../lib/context.js';

// Right-click a submission -> Apps -> "Submission ID". Admin-only, reply is ephemeral.
export default {
  admin: true,
  data: new ContextMenuCommandBuilder()
    .setName('Submission ID')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!isModerator(interaction.member, interaction.memberPermissions, db.getGuild(interaction.guildId))) {
      return reply('You need the **Manage Server** permission or the moderator role for this.');
    }
    const row = db.getConfessionByMessage(interaction.guildId, interaction.targetId);
    if (!row) return reply('That message is not a submission I posted.');
    return reply(`Submission ID: \`${row.sub_id}\` (${row.number ? `public ${anonRef(row.number)}` : 'no public number yet'}, ${row.status})\nUse it with \`/mod\`.`);
  },
};
