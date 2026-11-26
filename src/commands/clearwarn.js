import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { clearPanel, liftForUser, rememberReason } from '../lib/clear-warnings.js';
import { parseWarningCode } from '../lib/notices.js';
import { hasPin, isOwner, promptPin } from '../lib/owner-pin.js';

export default {
  // Server owner only, behind the owner PIN: naming a user and seeing their warnings would reveal who wrote a post.
  admin: true,
  data: new SlashCommandBuilder()
    .setName('clearwarn')
    .setDescription("Lift a user's warnings (server owner only, needs your PIN)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addUserOption((o) => o.setName('user').setDescription('The user (or use user_id)'))
    .addStringOption((o) => o.setName('user_id').setDescription('User ID, e.g. for someone who left the server').setMaxLength(25))
    .addStringOption((o) =>
      o.setName('warning').setDescription('A warning ID like W-0042, or "all" (leave empty to pick from a list)').setMaxLength(12),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Reason (sent to the user, shown in the mod log)').setMaxLength(500)),

  async execute(interaction) {
    // No deferReply here: the PIN pop-up has to be the first response.
    const no = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!(await isOwner(interaction))) return no('Only the server owner can use this.');
    if (!hasPin(interaction.guildId)) return no('You have no PIN yet. Run `/ownerpin` to set one, then try again.');

    const picked = interaction.options.getUser('user')?.id ?? null;
    const typed = interaction.options.getString('user_id')?.trim().replace(/^<@!?(\d+)>$/, '$1') || null;
    if (typed && !/^\d{17,20}$/.test(typed)) return no('That is not a user ID. It is a 17 to 20 digit number.');
    if (picked && typed && picked !== typed) return no('`user` and `user_id` are different people. Give just one.');
    const userId = picked ?? typed;
    if (!userId) return no('Give a `user` or a `user_id`.');

    const wanted = interaction.options.getString('warning')?.trim() || null;
    const reason = interaction.options.getString('reason')?.trim() || null;
    const what = !wanted ? null : wanted.toLowerCase() === 'all' ? 'all' : parseWarningCode(wanted);
    if (wanted && !what) return no('Give a warning ID like `W-0042`, or `all`.');

    return promptPin(interaction, 'action', {
      run: async (modal, guild) => {
        await modal.deferReply({ flags: MessageFlags.Ephemeral });
        if (!what) {
          rememberReason(modal.user.id, userId, reason);
          return modal.editReply(clearPanel(guild, userId));
        }
        return modal.editReply(await liftForUser(modal.client, guild, userId, what, modal.user, reason));
      },
    });
  },
};
