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
import * as db from '../db.js';
import { resolveGuild } from '../lib/context.js';
import { clearBotMessages, isClearing, reportResult, withClearLock } from '../lib/clear.js';
import { runBackup } from '../lib/backup.js';
import { backupEnabled } from '../lib/backup-crypto.js';

export default {
  admin: true,
  manageOnly: true,
  data: new SlashCommandBuilder()
    .setName('clearchannels')
    .setDescription('Delete my messages in the submissions, mod-log and/or backup channel (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addBooleanOption((o) => o.setName('submissions').setDescription('The submissions channel (the sticky button stays)'))
    .addBooleanOption((o) => o.setName('modlog').setDescription('The mod-log channel'))
    .addBooleanOption((o) => o.setName('backup').setDescription('The backup channel (a fresh backup is uploaded right after)'))
    .addStringOption((o) => o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, error } = await resolveGuild(interaction, { admin: true, manageOnly: true });
    if (error) return interaction.editReply(error);
    if (isClearing(guild.id)) return interaction.editReply('A clear is already running for this server.');

    const want = {
      submissions: interaction.options.getBoolean('submissions'),
      modlog: interaction.options.getBoolean('modlog'),
      backup: interaction.options.getBoolean('backup'),
    };
    if (!want.submissions && !want.modlog && !want.backup) {
      return interaction.editReply('Pick at least one: `submissions`, `modlog` or `backup`.');
    }

    const cfg = db.getGuild(guild.id);
    const ids = {
      submissions: cfg?.channel_id,
      modlog: cfg?.log_channel_id,
      backup: backupEnabled() ? process.env.BACKUP_CHANNEL_ID : null,
    };
    const jobs = []; // { label, channel, keepId, isBackup }
    const problems = [];
    for (const key of ['submissions', 'modlog', 'backup']) {
      if (!want[key]) continue;
      if (!ids[key]) {
        problems.push(`No ${key} channel is set${key === 'backup' ? ' (backups are off)' : ''}.`);
        continue;
      }
      const channel = await guild.channels.fetch(ids[key]).catch(() => null);
      if (!channel?.isTextBased()) {
        problems.push(`I cannot reach the ${key} channel in **${guild.name}**${key === 'backup' ? ' (it must be in this server)' : ''}.`);
        continue;
      }
      if (jobs.some((j) => j.channel.id === channel.id)) continue; // same channel picked twice
      jobs.push({ key, channel, keepId: key === 'submissions' ? cfg.sticky_id : null });
    }
    if (!jobs.length) return interaction.editReply(problems.join('\n'));

    const token = randomUUID();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`clearch:yes:${token}`).setLabel('Delete the messages').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`clearch:no:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    const hasBackup = jobs.some((j) => j.key === 'backup');
    const msg = await interaction.editReply({
      content:
        `This will delete **every message I posted** in: ${jobs.map((j) => `<#${j.channel.id}>`).join(', ')}. ` +
        'It **cannot be undone**. The confession records in my database are not touched.' +
        (hasBackup ? '\nClearing the backup channel removes all old backups. I upload a fresh one right after.' : '') +
        (problems.length ? `\n${problems.join('\n')}` : ''),
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
    if (click.customId.startsWith('clearch:no')) return click.update({ content: 'Cancelled. Nothing was deleted.', components: [] });
    await click.update({ content: 'Clearing. Large channels take a while. The result shows up here when done (by DM if it takes over 15 minutes).', components: [] });

    withClearLock(guild.id, async () => {
      const lines = [];
      for (const job of jobs) {
        try {
          const n = await clearBotMessages(job.channel, { keepId: job.keepId });
          lines.push(`<#${job.channel.id}>: ${n} deleted`);
        } catch (err) {
          lines.push(`<#${job.channel.id}>: failed (${err.message})`);
        }
      }
      if (hasBackup) {
        try {
          await runBackup(interaction.client, { force: true });
          lines.push('Fresh backup uploaded.');
        } catch (err) {
          lines.push(`Fresh backup FAILED (${err.message}). It will retry on the next change.`);
        }
      }
      return lines;
    })
      .then((lines) => reportResult(interaction, `Channel clear for **${guild.name}** finished:\n${lines.join('\n')}`))
      .catch((err) => {
        console.error('Channel clear failed:', err);
        return reportResult(interaction, `Channel clear for **${guild.name}** failed: ${err.message}`);
      });
  },
};
