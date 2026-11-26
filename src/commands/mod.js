import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
  time,
} from 'discord.js';
import * as db from '../db.js';
import { resolveGuild } from '../lib/context.js';
import { banAuthor, deleteSubmission, noteAuthor, restoreSubmission, unbanAuthor, warnAuthor } from '../lib/actions.js';
import { parseDuration, untilTag } from '../lib/duration.js';
import { historyEmbed } from '../lib/history.js';
import { COLOR, anonRef } from '../lib/format.js';
import { isPaused, postingMode, postingStatus } from '../lib/hours.js';
import { releaseScheduled } from '../lib/confession.js';
import { modLog } from '../lib/moderation.js';
import { queueEmbed, searchEmbed, statsEmbed } from '../lib/mod-views.js';
import { tagChoices } from '../lib/tags.js';

// `id` is the admin-only Submission ID (counts per server, never reused). The public number can repeat after a counter reset.
const idOpt = (o) =>
  o.setName('id').setDescription('Submission ID (admin-only; see the mod log or right-click the message)').setRequired(true).setMinValue(1);
const reasonOpt = (o) => o.setName('reason').setDescription('Reason (sent to the author, shown in the mod log)').setMaxLength(500);
const serverOpt = (o) => o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true);

const pageOpt = (o) => o.setName('page').setDescription('Page of results').setMinValue(1).setMaxValue(10000);
const VIEWS = new Set(['pause', 'resume', 'queue', 'stats', 'search']); // subcommands that are not about one submission

const banText = (ban) => (!ban ? 'No' : ban.expires_at ? `Until ${untilTag(ban.expires_at)}` : 'Yes (permanent)');

export default {
  admin: true, // Manage Server or the moderator role (/setup modrole)
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderate anonymous submissions (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addSubcommand((s) =>
      s.setName('delete').setDescription('Delete a submission').addIntegerOption(idOpt).addStringOption(reasonOpt).addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('warn')
        .setDescription('Warn the author of a submission')
        .addIntegerOption(idOpt)
        .addStringOption(reasonOpt)
        .addBooleanOption((o) => o.setName('delete').setDescription('Also delete the submission'))
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('ban')
        .setDescription('Ban the author of a submission from posting')
        .addIntegerOption(idOpt)
        .addStringOption(reasonOpt)
        .addBooleanOption((o) => o.setName('delete').setDescription('Also delete the submission (default: yes)'))
        .addStringOption((o) =>
          o.setName('duration').setDescription('How long: 30m, 12h, 7d, 2w (leave empty for a permanent ban)').setMaxLength(8),
        )
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('unban')
        .setDescription("Lift the ban on a submission's author")
        .addIntegerOption(idOpt)
        .addBooleanOption((o) => o.setName('clear_warnings').setDescription('Also reset their warnings (default: yes)'))
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s.setName('info').setDescription('Status of a submission and its author').addIntegerOption(idOpt).addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('restore')
        .setDescription('Put back a submission that was auto-hidden after reports, and dismiss its reports')
        .addIntegerOption(idOpt)
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('note')
        .setDescription("Add a private moderator note to a submission's author")
        .addIntegerOption(idOpt)
        .addStringOption((o) => o.setName('text').setDescription('The note').setRequired(true).setMaxLength(1000))
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription("Everything on record about a submission's author: posts, warnings, notes")
        .addIntegerOption(idOpt)
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('pause')
        .setDescription('Stop posting for a while: close submissions, or save them for later')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('What happens to new submissions (default: closed)')
            .addChoices(
              { name: 'closed: accept nothing', value: 'closed' },
              { name: 'hold: accept now, post when the pause ends', value: 'hold' },
            ),
        )
        .addStringOption((o) => o.setName('duration').setDescription('How long: 30m, 12h, 7d (leave empty until /mod resume)').setMaxLength(8))
        .addStringOption((o) => o.setName('reason').setDescription('Shown to people who try to submit').setMaxLength(200))
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) => s.setName('resume').setDescription('End a /mod pause and post anything saved').addStringOption(serverOpt))
    .addSubcommand((s) =>
      s.setName('queue').setDescription('Posts awaiting approval, hidden after reports, or saved for later').addIntegerOption(pageOpt).addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('stats')
        .setDescription('Server totals: posts, topics, reports, warnings')
        .addIntegerOption((o) => o.setName('days').setDescription('How far back (default 30)').setMinValue(1).setMaxValue(365))
        .addStringOption(serverOpt),
    )
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Find submissions by text, topic, status or age')
        .addStringOption((o) => o.setName('text').setDescription('Words in the post or its content warning').setMaxLength(100))
        .addStringOption((o) => o.setName('topic').setDescription('Topic').addChoices(...tagChoices()))
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Status')
            .addChoices(...['posted', 'pending', 'scheduled', 'hidden', 'deleted', 'rejected'].map((v) => ({ name: v, value: v }))),
        )
        .addIntegerOption((o) => o.setName('days').setDescription('Only the last N days').setMinValue(1).setMaxValue(3650))
        .addIntegerOption(pageOpt)
        .addStringOption(serverOpt),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, error } = await resolveGuild(interaction, { admin: true });
    if (error) return interaction.editReply(error);

    const sub = interaction.options.getSubcommand();
    if (VIEWS.has(sub)) return serverWide(interaction, guild, sub);
    const id = interaction.options.getInteger('id', true);
    const row = db.getConfessionBySubId(guild.id, id);
    if (!row) return interaction.editReply(`There is no submission with ID \`${id}\` in this server.`);

    const actor = interaction.user;
    const reason = interaction.options.getString('reason');
    const client = interaction.client;

    if (sub === 'info') {
      const cfg = db.getGuild(guild.id);
      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`Submission ID ${id}`)
        .addFields(
          { name: 'Public number', value: row.number ? anonRef(row.number) : 'Not posted yet', inline: true },
          { name: 'Status', value: row.status, inline: true },
          { name: 'Posted', value: time(Math.floor(row.created_at / 1000), 'R'), inline: true },
          { name: "Author's warnings", value: `${db.countWarnings(guild.id, row.author_key)}/${cfg.warn_limit}`, inline: true },
          { name: 'Author banned', value: banText(db.getBan(guild.id, row.author_key)), inline: true },
          { name: 'Reports', value: `${db.countReports(row.id)}${cfg.report_limit > 0 ? `/${cfg.report_limit}` : ''}`, inline: true },
        );
      if (row.channel_id && row.message_id) {
        embed.setDescription(`[Jump to message](https://discord.com/channels/${guild.id}/${row.channel_id}/${row.message_id})`);
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'history') return interaction.editReply({ embeds: [historyEmbed(guild, row)], allowedMentions: { parse: [] } });
    if (sub === 'restore') return interaction.editReply(await restoreSubmission(guild, row, actor));
    if (sub === 'note') return interaction.editReply(await noteAuthor(guild, row, actor, interaction.options.getString('text', true).trim()));

    if (sub === 'delete') return interaction.editReply(await deleteSubmission(guild, row, actor, reason));
    if (sub === 'warn') {
      const alsoDelete = interaction.options.getBoolean('delete') ?? false;
      return interaction.editReply(await warnAuthor(client, guild, row, actor, reason, { alsoDelete }));
    }
    if (sub === 'ban') {
      const alsoDelete = interaction.options.getBoolean('delete') ?? true;
      const parsed = parseDuration(interaction.options.getString('duration'));
      if (parsed.error) return interaction.editReply(parsed.error);
      return interaction.editReply(await banAuthor(client, guild, row, actor, reason, { alsoDelete, durationMs: parsed.ms }));
    }
    const clearWarnings = interaction.options.getBoolean('clear_warnings') ?? true;
    return interaction.editReply(await unbanAuthor(client, guild, row, actor, { clearWarnings }));
  },
};

/** /mod pause, resume, queue, stats and search. */
async function serverWide(interaction, guild, sub) {
  const { options, user } = interaction;
  const show = (embed) => interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });

  if (sub === 'queue') return show(queueEmbed(guild, options.getInteger('page') ?? 1));
  if (sub === 'stats') return show(statsEmbed(guild, options.getInteger('days') ?? 30));
  if (sub === 'search') {
    const days = options.getInteger('days');
    const filters = {
      text: options.getString('text')?.trim() || null,
      tag: options.getString('topic'),
      status: options.getString('status'),
      since: days ? Date.now() - days * 86_400_000 : null,
    };
    return show(searchEmbed(guild, filters, options.getInteger('page') ?? 1));
  }

  const cfg = db.getGuild(guild.id);
  if (!cfg?.channel_id) return interaction.editReply('Submissions are not set up in this server yet.');

  if (sub === 'pause') {
    const parsed = parseDuration(options.getString('duration'));
    if (parsed.error) return interaction.editReply('Duration looks like `30m`, `12h`, `7d` or `2w` (at most 365 days). Leave it empty to pause until `/mod resume`.');
    const until = parsed.ms ? Date.now() + parsed.ms : 0;
    const reason = options.getString('reason')?.trim() || null;
    const hold = options.getString('mode') === 'hold';
    const fresh = db.updateGuild(guild.id, { paused_until: until, pause_reason: reason, pause_hold: hold ? 1 : 0 });
    const length = until ? `until ${untilTag(until)}` : 'until `/mod resume`';
    await modLog(guild, {
      title: hold ? 'Posting paused (submissions are saved)' : 'Submissions paused',
      actor: user,
      reason,
      fields: [{ name: 'Length', value: length, inline: true }],
    });
    if (!hold) {
      const saved = db.countScheduled(guild.id);
      const kept = saved ? ` ${saved} saved submission${saved === 1 ? '' : 's'} will post after the pause.` : '';
      return interaction.editReply(`Submissions and replies are paused ${length}.${kept} Posts awaiting approval can still be approved.`);
    }
    // Quiet hours set to "closed" still refuse submissions while they run.
    const note = postingMode(fresh) === 'closed' ? ` Right now quiet hours are closing submissions: ${postingStatus(fresh)}` : '';
    return interaction.editReply(
      `Posting is paused ${length}. New submissions and replies are saved after their author agrees to wait, and go up when posting resumes.${note}`,
    );
  }

  // resume
  const after = { ...cfg, paused_until: null };
  const quiet = postingMode(after) === 'open' ? null : `Quiet hours still apply: ${postingStatus(after)}`;
  if (!isPaused(cfg)) return interaction.editReply(quiet ? `There is no pause to lift. ${quiet}` : 'Submissions are not paused.');
  db.updateGuild(guild.id, { paused_until: null, pause_reason: null, pause_hold: 0 });
  await modLog(guild, { title: 'Pause lifted', actor: user });
  const saved = db.countScheduled(guild.id);
  const queued = saved ? ` ${saved} saved submission${saved === 1 ? '' : 's'} ${quiet ? 'will post after that' : 'are being posted now'}.` : '';
  releaseSoon(guild);
  return interaction.editReply(quiet ? `The pause is lifted. ${quiet}${queued}` : `Submissions are open again.${queued}`);
}

/** Start posting saved submissions without making the moderator wait for it (it does nothing unless posting is open). */
function releaseSoon(guild) {
  releaseScheduled(guild).catch((err) => console.error(`Posting saved submissions failed for ${guild.id}:`, err));
}
