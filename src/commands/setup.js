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
import { postComponents, refreshSticky, removeSticky, resetCounterSafely } from '../lib/confession.js';
import { runDoctor } from '../lib/doctor.js';
import { ensureOwnerPin, hasPin } from '../lib/owner-pin.js';
import { highlightTimers } from '../lib/highlights.js';
import { tagChoices, tagText } from '../lib/tags.js';

const serverOpt = (s) =>
  s.addStringOption((o) => o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true));
const refreshing = new Set(); // servers with a /setup refreshposts run in progress
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
          .setDescription('Cooldown, join/account age, daily cap, repost blocker, warnings, reports, approval, polls, retention')
          .addIntegerOption((o) => o.setName('cooldown').setDescription('Seconds between submissions per user').setMinValue(0).setMaxValue(3600))
          .addIntegerOption((o) => o.setName('warn_limit').setDescription('Warnings before an automatic submission ban').setMinValue(1).setMaxValue(20))
          .addIntegerOption((o) =>
            o.setName('warn_expiry_days').setDescription('Warnings stop counting after this many days (0 = never)').setMinValue(0).setMaxValue(365),
          )
          .addIntegerOption((o) =>
            o.setName('report_limit').setDescription('Reports that auto-hide a post for review (0 = never auto-hide)').setMinValue(0).setMaxValue(50),
          )
          .addIntegerOption((o) =>
            o.setName('self_delete_minutes').setDescription('Minutes an author can delete their own post (0 = not allowed)').setMinValue(0).setMaxValue(1440),
          )
          .addIntegerOption((o) =>
            o
              .setName('retention_days')
              .setDescription('Erase sender ID, text and image of posts after this many days (0 = keep forever)')
              .setMinValue(0)
              .setMaxValue(3650),
          )
          .addBooleanOption((o) =>
            o.setName('approval').setDescription('New posts wait in the mod log until a moderator approves them (default: off, posts go up first)'),
          )
          .addIntegerOption((o) =>
            o.setName('poll_hours').setDescription('Polls close by themselves after this many hours (0 = stay open until closed)').setMinValue(0).setMaxValue(168),
          )
          .addIntegerOption((o) =>
            o.setName('min_join_days').setDescription('Members must be in the server this many days before posting (0 = off)').setMinValue(0).setMaxValue(365),
          )
          .addIntegerOption((o) =>
            o.setName('min_account_days').setDescription('Discord accounts must be this many days old to post (0 = off)').setMinValue(0).setMaxValue(3650),
          )
          .addIntegerOption((o) =>
            o.setName('daily_cap').setDescription('Most posts one person can make per 24 hours (0 = no cap)').setMinValue(0).setMaxValue(100),
          )
          .addIntegerOption((o) =>
            o.setName('dup_hours').setDescription('Block a post that repeats one from the last N hours (0 = off, default 24)').setMinValue(0).setMaxValue(168),
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
    .addSubcommand((s) =>
      serverOpt(
        channelOpts(
          s
            .setName('tagchannel')
            .setDescription('Send posts of one topic to their own channel (omit channel to use the main channel again)')
            .addStringOption((o) => o.setName('topic').setDescription('Topic').setRequired(true).addChoices(...tagChoices())),
        ),
      ),
    )
    .addSubcommand((s) =>
      serverOpt(
        channelOpts(
          s
            .setName('highlights')
            .setDescription('Auto-post the most-liked submission of the day / week')
            .addStringOption((o) =>
              o
                .setName('period')
                .setDescription('How often (default: keep the current setting)')
                .addChoices(
                  { name: 'Every day', value: 'daily' },
                  { name: 'Every week', value: 'weekly' },
                  { name: 'Both', value: 'both' },
                  { name: 'Off', value: 'off' },
                ),
            ),
        ),
      ),
    )
    .addSubcommand((s) =>
      serverOpt(
        channelOpts(
          s
            .setName('featured')
            .setDescription('Copy posts that collect enough 👍 to a featured channel')
            .addIntegerOption((o) => o.setName('threshold').setDescription('Likes (👍) needed. Default 5').setMinValue(1).setMaxValue(1000))
            .addBooleanOption((o) => o.setName('off').setDescription('Turn the featured channel off')),
        ),
      ),
    )
    .addSubcommand((s) =>
      serverOpt(
        s
          .setName('refreshposts')
          .setDescription('Give older posts the current buttons (Report, reactions, poll)')
          .addIntegerOption((o) => o.setName('count').setDescription('How many of the newest posts (default 50)').setMinValue(1).setMaxValue(200)),
      ),
    )
    .addSubcommand((s) => serverOpt(s.setName('doctor').setDescription('Check channels, permissions and settings for problems')))
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
      // First setup: make the owner's PIN and DM it to them (sender IDs are only viewable with it, see /sender).
      const pin = await ensureOwnerPin(guild);
      const pinNote =
        pin === 'sent'
          ? '\nThe server owner was sent their private PIN by DM. Sender IDs stay hidden; only the owner can look one up with `/sender`.'
          : pin === 'dm_failed'
            ? '\nI could not DM the server owner a PIN (closed DMs?). They can set one with `/ownerpin` after opening their DMs.'
            : '';
      return interaction.editReply(
        `Submissions channel set to <#${channel.id}> and the button is posted.\n` +
          `Tip: deny **Send Messages** for @everyone in that channel so only the bot posts there.${pinNote}`,
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
      const selfDelete = interaction.options.getInteger('self_delete_minutes');
      const retention = interaction.options.getInteger('retention_days');
      if (selfDelete !== null) patch.self_delete_minutes = selfDelete;
      if (retention !== null) patch.retention_days = retention;
      const approval = interaction.options.getBoolean('approval');
      const pollHours = interaction.options.getInteger('poll_hours');
      if (approval !== null) patch.approval_mode = approval ? 1 : 0;
      if (pollHours !== null) patch.poll_hours = pollHours;
      for (const key of ['min_join_days', 'min_account_days', 'daily_cap', 'dup_hours']) {
        const n = interaction.options.getInteger(key);
        if (n !== null) patch[key] = n;
      }
      if (cooldown !== null) patch.cooldown = cooldown;
      if (warnLimit !== null) patch.warn_limit = warnLimit;
      if (welcome !== null) patch.welcome_dm = welcome ? 1 : 0;
      if (!Object.keys(patch).length) return interaction.editReply('Nothing to change. Pass at least one option.');
      db.updateGuild(guild.id, patch);
      const warn =
        retention > 0
          ? `\nHeads up: posts older than ${retention} day${retention === 1 ? '' : 's'} lose their stored sender ID, text and image within the hour. ` +
            'This cannot be undone, and the entries already in your mod log channel are not touched.'
          : '';
      const queue =
        approval === true
          ? '\nApproval is **on**: new posts wait in the mod log with Approve / Reject buttons and get their number when approved. The guide says posts go up first and are moderated afterwards, so update the rules text if you keep this on.'
          : approval === false
            ? '\nApproval is **off**: posts go up first and are moderated afterwards. Posts already waiting keep waiting; approve or reject them in the mod log.'
            : '';
      return interaction.editReply(`Options saved. Use \`/setup view\` to check.${warn}${queue}`);
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

    if (sub === 'tagchannel') {
      const topic = interaction.options.getString('topic', true);
      const { id, channel } = await pickChannel(interaction, guild);
      if (!id) {
        db.setTagChannel(guild.id, topic, null);
        return interaction.editReply(`${tagText(topic)} posts go to the main channel again.`);
      }
      if (!channel || !textTypes.includes(channel.type)) return interaction.editReply('That is not a text channel in this server.');
      const me = guild.members.me ?? (await guild.members.fetchMe());
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
      if (!channel.permissionsFor(me)?.has(needed)) {
        return interaction.editReply('I need **View Channel**, **Send Messages** and **Embed Links** in that channel.');
      }
      db.setTagChannel(guild.id, topic, channel.id);
      return interaction.editReply(
        `${tagText(topic)} posts now go to <#${channel.id}>. The "Write a Submission" button stays in <#${cfg?.channel_id ?? 'the main channel'}>.`,
      );
    }

    if (sub === 'highlights') {
      const { id, channel } = await pickChannel(interaction, guild);
      const period = interaction.options.getString('period') ?? (cfg?.highlight_period && cfg.highlight_period !== 'off' ? cfg.highlight_period : 'daily');
      if (period === 'off') {
        db.updateGuild(guild.id, { highlight_period: 'off' });
        return interaction.editReply('Confession of the day / week is off.');
      }
      let target = cfg?.highlight_channel_id ?? null;
      if (id) {
        if (!channel || !textTypes.includes(channel.type)) return interaction.editReply('That is not a text channel in this server.');
        target = channel.id;
      }
      if (!target) return interaction.editReply('Give a `channel` (or `channel_id`) to post the highlights in.');
      const me = guild.members.me ?? (await guild.members.fetchMe());
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
      const dest = await guild.channels.fetch(target).catch(() => null);
      if (!dest?.permissionsFor(me)?.has(needed)) {
        return interaction.editReply('I need **View Channel**, **Send Messages** and **Embed Links** in that channel.');
      }
      db.updateGuild(guild.id, { ...highlightTimers(cfg, period), highlight_channel_id: target, highlight_period: period });
      const when = { daily: 'every 24 hours', weekly: 'every 7 days', both: 'every 24 hours and every 7 days' }[period];
      return interaction.editReply(
        `The most-liked submission (👍) will be posted in <#${target}> ${when}, starting from now. Nothing is posted if nobody liked anything.`,
      );
    }

    if (sub === 'featured') {
      if (interaction.options.getBoolean('off')) {
        db.updateGuild(guild.id, { featured_channel_id: null });
        return interaction.editReply('Featured channel is off. Posts that were already featured stay where they are.');
      }
      const { id, channel } = await pickChannel(interaction, guild);
      const threshold = interaction.options.getInteger('threshold');
      const patch = {};
      if (id) {
        if (!channel || !textTypes.includes(channel.type)) return interaction.editReply('That is not a text channel in this server.');
        const me = guild.members.me ?? (await guild.members.fetchMe());
        const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
        if (!channel.permissionsFor(me)?.has(needed)) {
          return interaction.editReply('I need **View Channel**, **Send Messages** and **Embed Links** in that channel.');
        }
        patch.featured_channel_id = channel.id;
      }
      if (threshold !== null) patch.featured_threshold = threshold;
      if (!Object.keys(patch).length) return interaction.editReply('Give a `channel` and/or a `threshold`.');
      const saved = db.updateGuild(guild.id, patch);
      if (!saved.featured_channel_id) return interaction.editReply(`Threshold saved (${saved.featured_threshold}). Pick a \`channel\` to turn the featured channel on.`);
      return interaction.editReply(
        `Posts with **${saved.featured_threshold}** or more 👍 are now copied to <#${saved.featured_channel_id}>. Posts that already have that many are featured on their next reaction.`,
      );
    }

    if (sub === 'refreshposts') {
      if (refreshing.has(guild.id)) return interaction.editReply('A refresh is already running for this server.');
      const rows = db.listRecentPosted(guild.id, interaction.options.getInteger('count') ?? 50);
      if (!rows.length) return interaction.editReply('There are no posts to refresh.');
      refreshing.add(guild.id);
      await interaction.editReply(`Refreshing ${rows.length} post${rows.length === 1 ? '' : 's'}. This takes about ${Math.ceil(rows.length * 0.7)} seconds...`);
      let done = 0;
      let gone = 0;
      let failed = 0;
      try {
        for (const row of rows) {
          const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
          if (!channel) failed++;
          else {
            try {
              await channel.messages.edit(row.message_id, { components: postComponents(row) });
              done++;
            } catch (err) {
              if (err.code === 10008) {
                db.markConfession(guild.id, row.id, 'deleted'); // the message was removed by hand
                gone++;
              } else failed++;
            }
          }
          await sleep(700); // stay under Discord's edit rate limit
        }
      } finally {
        refreshing.delete(guild.id);
      }
      return interaction.editReply(
        `Done: ${done} refreshed${gone ? `, ${gone} were already deleted in Discord` : ''}${failed ? `, ${failed} failed (missing access?)` : ''}.`,
      );
    }

    if (sub === 'refresh') {
      if (!cfg?.channel_id) return interaction.editReply('Run `/setup channel` first.');
      await refreshSticky(guild);
      return interaction.editReply('Button message reposted.');
    }

    if (sub === 'doctor') {
      return interaction.editReply({ embeds: [await runDoctor(guild)], allowedMentions: { parse: [] } });
    }

    // view
    const c = cfg ?? {};
    const routes = db.listTagChannels(guild.id);
    const ruleCount = db.listFilterRules(guild.id).length;
    const filterSummary =
      ruleCount || c.block_invites || c.block_links
        ? `${ruleCount} rule${ruleCount === 1 ? '' : 's'}${c.block_invites ? ', invites blocked' : ''}${c.block_links ? ', links blocked' : ''} → ${c.filter_action === 'hold' ? 'hold' : 'reject'}`
        : 'Off';
    const topicValue = routes.length
      ? routes.map((r) => `${tagText(r.tag) ?? r.tag} → <#${r.channel_id}>`).join('\n').slice(0, 1000)
      : 'None (everything goes to the main channel)';
    const highlight =
      c.highlight_channel_id && c.highlight_period && c.highlight_period !== 'off'
        ? `${{ daily: 'Daily', weekly: 'Weekly', both: 'Daily + weekly' }[c.highlight_period]} in <#${c.highlight_channel_id}>`
        : 'Off';
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
        { name: 'Minimum time in server', value: c.min_join_days > 0 ? `${c.min_join_days} days` : 'Off', inline: true },
        { name: 'Minimum account age', value: c.min_account_days > 0 ? `${c.min_account_days} days` : 'Off', inline: true },
        { name: 'Daily post cap', value: c.daily_cap > 0 ? `${c.daily_cap} per 24 h` : 'Off', inline: true },
        { name: 'Repost blocker', value: c.dup_hours > 0 ? `Same text within ${c.dup_hours} h` : 'Off', inline: true },
        { name: 'Warn limit', value: `${c.warn_limit ?? 3}`, inline: true },
        { name: 'Warning expiry', value: c.warn_expiry_days > 0 ? `${c.warn_expiry_days} days` : 'Never', inline: true },
        { name: 'Approval queue', value: c.approval_mode ? 'On (posts wait for a moderator)' : 'Off (post first, moderate after)', inline: true },
        { name: 'Auto-filter', value: filterSummary, inline: true },
        { name: 'Poll length', value: c.poll_hours > 0 ? `${c.poll_hours} h` : 'Until closed', inline: true },
        { name: 'Featured channel', value: c.featured_channel_id ? `<#${c.featured_channel_id}> (${c.featured_threshold} likes)` : 'Off', inline: true },
        { name: 'Self-delete window', value: c.self_delete_minutes > 0 ? `${c.self_delete_minutes} min` : 'Off', inline: true },
        { name: 'Data retention', value: c.retention_days > 0 ? `${c.retention_days} days` : 'Keep forever', inline: true },
        { name: 'Report limit', value: c.report_limit > 0 ? `${c.report_limit} (auto-hide)` : 'Off (no auto-hide)', inline: true },
        { name: 'Confession of the day / week', value: highlight, inline: true },
        { name: 'Topic channels', value: topicValue },
        { name: 'Welcome DM', value: c.welcome_dm ? 'On' : 'Off', inline: true },
        { name: 'Owner PIN', value: hasPin(guild.id) ? 'Set' : 'Not set (owner: run /ownerpin)', inline: true },
        { name: 'Next public number', value: anonRef((c.counter ?? 0) + 1), inline: true },
      );
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
