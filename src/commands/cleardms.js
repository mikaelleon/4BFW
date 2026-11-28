import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { clearDmsWith, isClearing, reportResult, withClearLock } from '../lib/clear.js';
import { hasPin, isOwner, promptPin } from '../lib/owner-pin.js';

const MAX_PEOPLE = 2000;

/** Pull user IDs out of free text: raw IDs and <@mentions> both work. */
const parseIds = (text) => [...(text ?? '').matchAll(/\d{17,20}/g)].map((m) => m[0]);

export default {
  // Server owner only, behind the owner PIN: how many DMs a person has (or how long deleting them takes) shows whether
  // they were warned, which would reveal who wrote a post. It also wipes warning notices people may need.
  admin: true,
  data: new SlashCommandBuilder()
    .setName('cleardms')
    .setDescription('Delete the DMs I sent to members (server owner only, needs your PIN)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addBooleanOption((o) => o.setName('everyone').setDescription('Every member of the server'))
    .addRoleOption((o) => o.setName('role').setDescription('Everyone with this role'))
    .addStringOption((o) => o.setName('role_id').setDescription('Role ID (use this in DMs, where the role picker is unavailable)'))
    .addUserOption((o) => o.setName('user').setDescription('One specific person'))
    .addStringOption((o) => o.setName('user_ids').setDescription('More people: user IDs or @mentions, separated by spaces or commas')),

  async execute(interaction) {
    // No deferReply here: the PIN pop-up has to be the first response.
    const no = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!(await isOwner(interaction))) return no('Only the server owner can use this.');
    if (!await hasPin(interaction.guildId)) return no('You have no PIN yet. Run `/ownerpin` to set one, then try again.');
    if (isClearing(interaction.guildId)) return no('A clear is already running for this server.');

    const everyone = interaction.options.getBoolean('everyone');
    const roleId = interaction.options.getRole('role')?.id ?? interaction.options.getString('role_id')?.trim();
    const ids = new Set(parseIds(interaction.options.getString('user_ids')));
    const picked = interaction.options.getUser('user');
    if (picked) ids.add(picked.id);
    if (!everyone && !roleId && !ids.size) return no('Pick who to clear: `everyone`, a `role` (or `role_id`), a `user`, or `user_ids`.');

    return await promptPin(interaction, 'action', {
      run: async (modal, guild) => {
        await modal.deferReply({ flags: MessageFlags.Ephemeral });
        return confirmAndClear(modal, guild, { everyone, roleId, ids });
      },
    });
  },
};

/** After the PIN: work out who is affected, ask for confirmation, then delete in the background. */
async function confirmAndClear(interaction, guild, { everyone, roleId, ids }) {
  let role = null;
  if (roleId) {
    role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) return interaction.editReply('I could not find that role.');
  }

  // Only people who are in this server: an admin here cannot wipe DMs of strangers.
  const members = await guild.members.fetch();
  const targets = new Map();
  for (const m of members.values()) {
    if (m.user.bot) continue;
    if (everyone || (role && m.roles.cache.has(role.id)) || ids.has(m.id)) targets.set(m.id, m.user);
  }
  const unknown = [...ids].filter((id) => !members.has(id)).length;
  if (!targets.size) return interaction.editReply('No members matched. Nothing to clear.');
  if (targets.size > MAX_PEOPLE) return interaction.editReply(`That is ${targets.size} people. The limit is ${MAX_PEOPLE} per run.`);

  const who = [everyone && 'every member', role && `members with **${role.name}**`, ids.size && 'the listed people']
    .filter(Boolean)
    .join(' + ');
  const token = randomUUID();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cleardms:yes:${token}`).setLabel('Delete the DMs').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cleardms:no:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const msg = await interaction.editReply({
    content:
      `This will delete **every DM I ever sent** to **${targets.size}** ${targets.size === 1 ? 'person' : 'people'} ` +
      `(${who}), including warnings, bans and notices, not only the guide. This **cannot be undone**. Their own messages are not touched.` +
      (unknown ? `\n${unknown} listed ID${unknown === 1 ? ' is' : 's are'} not in this server and will be skipped.` : ''),
    components: [row],
  });

  let click;
  try {
    click = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id && i.customId.endsWith(token),
      time: 60_000,
    });
  } catch {
    return interaction.editReply({ content: 'Timed out. Nothing was deleted.', components: [] });
  }
  if (click.customId.startsWith('cleardms:no')) return click.update({ content: 'Cancelled. Nothing was deleted.', components: [] });
  await click.update({
    content: `Clearing DMs for ${targets.size} ${targets.size === 1 ? 'person' : 'people'}. It is throttled to stay under Discord rate limits; The result shows up here when done (by DM if it takes over 15 minutes).`,
    components: [],
  });

  // Runs in the background: can outlast the 15 minute interaction window.
  withClearLock(guild.id, async () => {
    const stats = { people: 0, messages: 0, failed: 0 };
    for (const user of targets.values()) {
      try {
        stats.messages += await clearDmsWith(interaction.client, user);
        stats.people++;
      } catch {
        stats.failed++; // DMs closed, user blocked the bot, etc.
      }
    }
    return stats;
  })
    .then((s) =>
      reportResult(
        interaction,
        `DM clear for **${guild.name}** finished: ${s.messages} message${s.messages === 1 ? '' : 's'} deleted across ${s.people} ${s.people === 1 ? 'person' : 'people'}, ${s.failed} could not be reached.`,
      ),
    )
    .catch((err) => {
      console.error('DM clear failed:', err);
      return reportResult(interaction, `DM clear for **${guild.name}** failed: ${err.message}`);
    });
}
