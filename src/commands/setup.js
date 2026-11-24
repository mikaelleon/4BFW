import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import * as db from '../db.js';
import { resolveGuild } from '../lib/context.js';
import { COLOR, anonRef } from '../lib/format.js';
import { refreshSticky, removeSticky, resetCounterSafely } from '../lib/confession.js';

const serverOpt = (s) =>
  s.addStringOption((o) => o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true));
const textTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

async function pickChannel(interaction, guild) {
  const id = interaction.options.getChannel('channel')?.id ?? interaction.options.getString('channel_id')?.trim() ?? null;
  if (!id) return { id: null, channel: null };
  return { id, channel: await guild.channels.fetch(id).catch(() => null) };
}

const channelOpts = (s) =>
  s
    .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(...textTypes))
    .addStringOption((o) => o.setName('channel_id').setDescription('Channel ID (use this in DMs, where the picker is unavailable)'));

export default {
  admin: true,
  manageOnly: true,
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure the 4BFW bot (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addSubcommand((s) =>
      serverOpt(channelOpts(s.setName('channel').setDescription('Set the submissions channel and post the button'))),
    )
    .addSubcommand((s) =>
      serverOpt(channelOpts(s.setName('modlog').setDescription('Set the moderation log channel (omit channel to clear)'))),
    )
    .addSubcommand((s) =>
      serverOpt(
        s
          .setName('role')
          .setDescription('Set the role that receives the guide (omit role to clear)')
          .addRoleOption((o) => o.setName('role').setDescription('Role'))
          .addStringOption((o) => o.setName('role_id').setDescription('Role ID (use this in DMs)')),
      ),
    )
    .addSubcommand((s) =>
      serverOpt(
        s
          .setName('onlinerole')
          .setDescription('Set the role that gets a DM when the bot comes online (omit role to clear)')
          .addRoleOption((o) => o.setName('role').setDescription('Role'))
          .addStringOption((o) => o.setName('role_id').setDescription('Role ID (use this in DMs)')),
      ),
    )
    .addSubcommand((s) =>
      serverOpt(
        s
          .setName('modrole')
          .setDescription('Set the role that can use mod-log buttons and /mod (omit role to clear)')
          .addRoleOption((o) => o.setName('role').setDescription('Role'))
          .addStringOption((o) => o.setName('role_id').setDescription('Role ID (use this in DMs)')),
      ),
    )
    .addSubcommand((s) =>
      serverOpt(
        s
          .setName('options')
          .setDescription('Cooldown, warning limit and expiry, report limit, welcome DM')
          .addIntegerOption((o) => o.setName('cooldown').setDescription('Seconds between submissions per user').setMinValue(0).setMaxValue(3600))
          .addIntegerOption((o) => o.setName('warn_limit').setDescription('Warnings before an automatic submission ban').setMinValue(1).setMaxValue(20))
          .addIntegerOption((o) =>
            o.setName('warn_expiry_days').setDescription('Warnings stop counting after this many days (0 = never)').setMinValue(0).setMaxValue(365),
          )
          .addIntegerOption((o) =>
            o.setName('report_limit').setDescription('Reports that auto-hide a post for review (0 = never auto-hide)').setMinValue(0).setMaxValue(50),
          )
          .addBooleanOption((o) => o.setName('welcome_dm').setDescription('DM the guide to new members when they join')),
      ),
    )
    .addSubcommand((s) =>
      serverOpt(
        s
          .setName('reset_count')
          .setDescription('Restart public submission numbering (e.g. when moving channels)')
          .addBooleanOption((o) => o.setName('confirm').setDescription('Set to true to confirm the reset').setRequired(true))
          .addIntegerOption((o) => o.setName('start_at').setDescription('Number for the next submission (default 1)').setMinValue(1)),
      ),
    )
    .addSubcommand((s) => serverOpt(s.setName('view').setDescription('Show current settings')))
    .addSubcommand((s) => serverOpt(s.setName('refresh').setDescription('Repost the button message at the bottom of the channel'))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, error } = await resolveGuild(interaction, { admin: true, manageOnly: true });
    if (error) return interaction.editReply(error);

    const sub = interaction.options.getSubcommand();
    const cfg = db.getGuild(guild.id);

    if (sub === 'channel') {
      const { id, channel } = await pickChannel(interaction, guild);
      if (!id) return interaction.editReply('Give a `channel` (or `channel_id`).');
      if (!channel || !textTypes.includes(channel.type)) return interaction.editReply('That is not a text channel in this server.');

      const me = guild.members.me ?? (await guild.members.fetchMe());
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
      if (!channel.permissionsFor(me)?.has(needed)) {
        return interaction.editReply('I need **View Channel**, **Send Messages** and **Embed Links** in that channel.');
      }

      if (cfg?.channel_id && cfg.channel_id !== channel.id) await removeSticky(guild);
      db.updateGuild(guild.id, { channel_id: channel.id });
      await refreshSticky(guild);
      return interaction.editReply(
        `Submissions channel set to <#${channel.id}> and the button is posted.\n` +
          'Tip: deny **Send Messages** for @everyone in that channel so only the bot posts there.',
      );
    }

    if (sub === 'modlog') {
      const { id, channel } = await pickChannel(interaction, guild);
      if (!id) {
        db.updateGuild(guild.id, { log_channel_id: null });
        return interaction.editReply('Moderation log cleared.');
      }
      if (!channel || !textTypes.includes(channel.type)) return interaction.editReply('That is not a text channel in this server.');
      db.updateGuild(guild.id, { log_channel_id: channel.id });
      return interaction.editReply(`Moderation log set to <#${channel.id}>.`);
    }

    if (sub === 'role') {
      const id = interaction.options.getRole('role')?.id ?? interaction.options.getString('role_id')?.trim() ?? null;
      if (!id) {
        db.updateGuild(guild.id, { role_id: null });
        return interaction.editReply('Guide role cleared.');
      }
      const role = await guild.roles.fetch(id).catch(() => null);
      if (!role) return interaction.editReply('I could not find that role.');
      db.updateGuild(guild.id, { role_id: role.id });
      return interaction.editReply(`Guide role set to **${role.name}**. Use \`/announce\` to DM them the guide.`);
    }

    if (sub === 'onlinerole') {
      const id = interaction.options.getRole('role')?.id ?? interaction.options.getString('role_id')?.trim() ?? null;
      if (!id) {
        db.updateGuild(guild.id, { online_role_id: null });
        return interaction.editReply('Online notice role cleared.');
      }
      const role = await guild.roles.fetch(id).catch(() => null);
      if (!role) return interaction.editReply('I could not find that role.');
      db.updateGuild(guild.id, { online_role_id: role.id });
      return interaction.editReply(
        `Members with **${role.name}** will get a DM whenever the bot comes online (at most once every 30 minutes).`,
      );
    }

    if (sub === 'modrole') {
      const id = interaction.options.getRole('role')?.id ?? interaction.options.getString('role_id')?.trim() ?? null;
      if (!id) {
        db.updateGuild(guild.id, { mod_role_id: null });
        return interaction.editReply('Moderator role cleared. Only members with **Manage Server** can moderate now.');
      }
      const role = await guild.roles.fetch(id).catch(() => null);
      if (!role) return interaction.editReply('I could not find that role.');
      db.updateGuild(guild.id, { mod_role_id: role.id });
      return interaction.editReply(
        `Members with **${role.name}** can now use the Warn / Delete / Ban buttons in the mod log and the \`/mod\` commands.\n` +
          'If `/mod` does not show up for them, allow it for that role under Server Settings > Integrations > 4BFW.',
      );
    }

    if (sub === 'options') {
      const patch = {};
      const cooldown = interaction.options.getInteger('cooldown');
      const warnLimit = interaction.options.getInteger('warn_limit');
      const welcome = interaction.options.getBoolean('welcome_dm');
      const warnExpiry = interaction.options.getInteger('warn_expiry_days');
      const reportLimit = interaction.options.getInteger('report_limit');
      if (warnExpiry !== null) patch.warn_expiry_days = warnExpiry;
      if (reportLimit !== null) patch.report_limit = reportLimit;
      if (cooldown !== null) patch.cooldown = cooldown;
      if (warnLimit !== null) patch.warn_limit = warnLimit;
      if (welcome !== null) patch.welcome_dm = welcome ? 1 : 0;
      if (!Object.keys(patch).length) return interaction.editReply('Nothing to change. Pass at least one option.');
      db.updateGuild(guild.id, patch);
      return interaction.editReply('Options saved. Use `/setup view` to check.');
    }

    if (sub === 'reset_count') {
      if (!interaction.options.getBoolean('confirm', true)) return interaction.editReply('Reset cancelled. Pass `confirm: true` to proceed.');
      const startAt = interaction.options.getInteger('start_at') ?? 1;
      // Serialised with posting so a submission in flight cannot get a stale number.
      await resetCounterSafely(guild, startAt);
      return interaction.editReply(
        `Public numbering reset. The next submission will be **${anonRef(startAt)}**.\n` +
          'Old submissions keep their Submission IDs, so `/mod` still works on them. Numbers can now repeat across old and new posts.',
      );
    }

    if (sub === 'refresh') {
      if (!cfg?.channel_id) return interaction.editReply('Run `/setup channel` first.');
      await refreshSticky(guild);
      return interaction.editReply('Button message reposted.');
    }

    // view
    const c = cfg ?? {};
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`Settings for ${guild.name}`)
      .addFields(
        { name: 'Submissions channel', value: c.channel_id ? `<#${c.channel_id}>` : 'Not set', inline: true },
        { name: 'Mod log', value: c.log_channel_id ? `<#${c.log_channel_id}>` : 'Not set', inline: true },
        { name: 'Guide role', value: c.role_id ? `<@&${c.role_id}>` : 'Not set', inline: true },
        { name: 'Online notice role', value: c.online_role_id ? `<@&${c.online_role_id}>` : 'Not set', inline: true },
        { name: 'Moderator role', value: c.mod_role_id ? `<@&${c.mod_role_id}>` : 'Not set', inline: true },
        { name: 'Cooldown', value: `${c.cooldown ?? 30}s`, inline: true },
        { name: 'Warn limit', value: `${c.warn_limit ?? 3}`, inline: true },
        { name: 'Warning expiry', value: c.warn_expiry_days > 0 ? `${c.warn_expiry_days} days` : 'Never', inline: true },
        { name: 'Report limit', value: c.report_limit > 0 ? `${c.report_limit} (auto-hide)` : 'Off (no auto-hide)', inline: true },
        { name: 'Welcome DM', value: c.welcome_dm ? 'On' : 'Off', inline: true },
        { name: 'Next public number', value: anonRef((c.counter ?? 0) + 1), inline: true },
      );
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
