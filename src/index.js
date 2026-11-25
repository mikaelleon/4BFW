import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import './restore.js'; // must stay before db.js: restores the DB from the backup channel if the disk was wiped
import {
  ActionRowBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  StringSelectMenuBuilder,
} from 'discord.js';
import * as db from './db.js';
import { commands } from './commands/index.js';
import { candidateGuilds, serverAutocomplete } from './lib/context.js';
import {
  MAX_LEN,
  MODAL_ID,
  GUIDE_BUTTON_ID,
  OPEN_BUTTON_ID,
  REPLY_BUTTON_ID,
  REACT_PREFIX,
  REPORT_BUTTON_ID,
  VOTE_PREFIX,
  confessModal,
  ensureSticky,
  submitConfession,
} from './lib/confession.js';
import { anonTitle, prefix } from './lib/format.js';
import { downloadImage, imageHelp, pickImage, prepareImage, uploadLimit } from './lib/image.js';
import { CONTROL_PREFIX } from './lib/controls-row.js';
import { REASON_PREFIX, handleControlButton, handleReasonModal } from './lib/controls.js';
import { handleReactionButton, handleVoteButton, parsePollOptions } from './lib/engagement.js';
import { REPORT_MODAL_PREFIX, handleReportButton, handleReportModal } from './lib/reports.js';
import { startScheduler } from './lib/scheduler.js';
import { startBackups } from './lib/backup.js';
import { GUIDE_PREFIX, RULES_PAGE, dmGuide, guidePayload, notifyOnline } from './lib/guide.js';
import { APPEAL_PREFIX, handleAppealButton } from './lib/appeals.js';
import { BAN_APPEAL_PREFIX, appealUsage, bannedGuildsOf, handleBanAppealButton, submitBanAppeal } from './lib/ban-appeals.js';
import { RULES_PREFIX } from './lib/notices.js';

// Keep-alive endpoint for hosts that need an open port (Render + UptimeRobot).
http
  .createServer((_, res) => res.end('ok'))
  .listen(process.env.PORT || 3000);

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  // GuildMembers is a privileged intent: enable it in the developer portal (used for /announce and member checks).
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message], // required to receive DMs
});

const EPHEMERAL = MessageFlags.Ephemeral;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* DMs where the user is in several servers: remember their text while they pick one. */
const pending = new Map(); // token -> { userId, text, image, note, expires }
setInterval(() => {
  const now = Date.now();
  for (const [token, p] of pending) if (p.expires < now) pending.delete(token);
}, 60_000).unref();

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  for (const cfg of db.configuredGuilds()) {
    const guild = c.guilds.cache.get(cfg.guild_id);
    if (guild) await ensureSticky(guild).catch((err) => console.error(`Sticky check failed for ${guild.id}:`, err));
  }
  startScheduler(c);
  startBackups(c);
  catchUpDms(c).catch((err) => console.error('DM catch-up failed:', err));
  // Online notices are slow (throttled DMs), so run them after the sticky checks and in the background.
  for (const cfg of db.configuredGuilds()) {
    const guild = c.guilds.cache.get(cfg.guild_id);
    if (guild) notifyOnline(guild).catch((err) => console.error(`Online notice failed for ${guild.id}:`, err));
  }
});

/* ---------- DM: "fw <text>" (or the /fw slash command) ---------- */

/** Handle one DM. `catchUp` = it was sent while the bot was offline: no usage reply for non-submissions, and the user is told it was late. */
async function handleDm(message, catchUp = false) {
  const p = prefix();
  const usage = `To post anonymously, send:\n\`${p} <your message>\`\nAttach an image to include it in your post.\n\nOr use the \`/fw\` command (it has an image option too).`;
  const match = message.content.trim().match(new RegExp(`^${escapeRe(p)}(?:\\s+([\\s\\S]*))?$`, 'i'));
  if (!match) return catchUp ? undefined : message.author.send(usage).catch(() => {});

  const text = (match[1] ?? '').trim();
  const dm = (content) => message.author.send(content).catch(() => {});

  // "fw appeal <why>" from a banned user goes to the moderators. Anyone who is not banned anywhere: it is just a post.
  const appeal = text.match(/^appeal(?:\s+([\s\S]*))?$/i);
  if (appeal) {
    const banned = await bannedGuildsOf(client, message.author.id);
    if (banned.length) {
      const why = (appeal[1] ?? '').trim();
      if (!why) return dm(appealUsage());
      if (banned.length === 1) return dm(await submitBanAppeal(banned[0], message.author, why));
      const token = randomUUID().slice(0, 8);
      pending.set(token, { userId: message.author.id, appealText: why, expires: Date.now() + 5 * 60_000 });
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`confess:pick:${token}`)
        .setPlaceholder('Which server?')
        .addOptions(banned.slice(0, 25).map((g) => ({ label: g.name.slice(0, 100), value: g.id })));
      return message.author.send({ content: 'You are banned in several servers. Which ban are you appealing?', components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => {});
    }
  }

  const guilds = await candidateGuilds(client, message.author.id);
  if (guilds.length === 0) return dm('I found no server you are in that has submissions set up.');

  // One image per post, re-uploaded into the channel. Size cap = Discord's upload limit of the biggest candidate
  // server; submitConfession re-checks it against the server actually chosen.
  const limit = Math.max(...guilds.map(uploadLimit));
  const { image: attachment, extra, rejected } = pickImage(message.attachments, limit);
  if (!text && !attachment) return dm(rejected ? imageHelp(limit) : usage);
  if (text.length > MAX_LEN) return dm(`Too long. Max ${MAX_LEN} characters.`);

  let image = null;
  if (attachment) {
    try {
      image = await downloadImage(attachment, limit);
    } catch (err) {
      console.error('Image download failed:', err);
      return dm('I could not download that image. Try sending it again.');
    }
  }
  const note = [extra ? 'Only the first image was used.' : '', rejected && attachment ? `Skipped a file I cannot use. ${imageHelp(limit)}` : '']
    .filter(Boolean)
    .join(' ');
  const late = catchUp ? ' I was offline when you sent it, so it went up late.' : '';
  const posted = (res, guild) => (res.ok ? `Posted as **${anonTitle(res.number)}** in **${guild.name}**.${late}${note ? `\n${note}` : ''}` : res.error);

  if (guilds.length === 1) return dm(posted(await submitConfession(guilds[0], message.author.id, text, null, image), guilds[0]));

  const token = randomUUID().slice(0, 8);
  pending.set(token, { userId: message.author.id, text, image, note, expires: Date.now() + 5 * 60_000 });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`confess:pick:${token}`)
    .setPlaceholder('Which server?')
    .addOptions(guilds.slice(0, 25).map((g) => ({ label: g.name.slice(0, 100), value: g.id })));
  return message.author
    .send({ content: `Which server should this go to?${late}`, components: [new ActionRowBuilder().addComponents(menu)] })
    .catch(() => {});
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.guildId) return;
  db.setDmCursor(message.author.id, message.id);
  await handleDm(message);
});

/* ---------- DM catch-up: submissions sent while the bot was offline ---------- */

const CATCHUP_MAX_AGE_MS = 24 * 60 * 60_000; // older than this is stale: ignored
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function catchUpDms(c) {
  for (const userId of db.knownDmUsers()) {
    try {
      const user = await c.users.fetch(userId);
      const dm = await user.createDM();
      const cursor = db.getDmCursor(userId);

      if (!cursor) {
        // First time we see this user: remember where their DM stands, process nothing old.
        const [latest] = (await dm.messages.fetch({ limit: 1 })).values();
        if (latest) db.setDmCursor(userId, latest.id);
        continue;
      }

      const missed = [...(await dm.messages.fetch({ after: cursor, limit: 50 })).values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const message of missed) {
        // A live message may have moved the cursor while we were busy: never handle one twice.
        const current = db.getDmCursor(userId);
        if (current && BigInt(message.id) <= BigInt(current)) continue;
        db.setDmCursor(userId, message.id);
        if (message.author.bot || message.author.id !== userId) continue;
        if (Date.now() - message.createdTimestamp > CATCHUP_MAX_AGE_MS) continue;
        await handleDm(message, true);
      }
    } catch (err) {
      console.error(`DM catch-up failed for ${userId}:`, err.message);
    }
    await sleep(300);
  }
}

/* ---------- welcome DM ---------- */

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;
  const cfg = db.getGuild(member.guild.id);
  if (cfg?.welcome_dm && cfg.channel_id) await dmGuide(member.user, member.guild).catch(() => {});
});

/* ---------- interactions ---------- */

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd && interaction.options.getFocused(true).name === 'server') await serverAutocomplete(interaction, { admin: cmd.admin, manageOnly: cmd.manageOnly });
      return;
    }

    if (interaction.isChatInputCommand() || interaction.isMessageContextMenuCommand()) {
      await commands.get(interaction.commandName)?.execute(interaction);
      return;
    }

    // Moderation buttons under mod-log entries, and the reason pop-up they open.
    if (interaction.isButton() && interaction.customId.startsWith(`${CONTROL_PREFIX}:`)) {
      return handleControlButton(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${REASON_PREFIX}:`)) {
      return handleReasonModal(interaction);
    }

    // Lift / Deny buttons on a ban appeal in the mod log.
    if (interaction.isButton() && interaction.customId.startsWith(`${BAN_APPEAL_PREFIX}:`)) {
      return handleBanAppealButton(interaction);
    }

    // Overturn / Uphold buttons on a warning appeal in the mod log.
    if (interaction.isButton() && interaction.customId.startsWith(`${APPEAL_PREFIX}:`)) {
      return handleAppealButton(interaction);
    }

    // "Read the rules" button in a warning, ban or removal DM: opens the guide on its Rules page as a new message.
    if (interaction.isButton() && interaction.customId.startsWith(`${RULES_PREFIX}:`)) {
      const guild = client.guilds.cache.get(interaction.customId.split(':')[1]);
      if (!guild) return interaction.reply({ content: 'I can no longer reach that server.', flags: EPHEMERAL });
      return interaction.reply(guidePayload(guild, RULES_PAGE));
    }

    // Guide page buttons ("guide:<guildId>:<page>"), in DMs or ephemeral /guide replies.
    if (interaction.isButton() && interaction.customId.startsWith(`${GUIDE_PREFIX}:`)) {
      const [, guildId, page] = interaction.customId.split(':');
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return interaction.reply({ content: 'I can no longer reach that server.', flags: EPHEMERAL });
      return interaction.update(guidePayload(guild, Number(page)));
    }

    // "View Guide" button on the sticky: guide shown only to the clicker.
    if (interaction.isButton() && interaction.customId === GUIDE_BUTTON_ID) {
      if (!interaction.guild) return interaction.reply({ content: 'Use this button inside a server.', flags: EPHEMERAL });
      return interaction.reply({ ...guidePayload(interaction.guild, 0), flags: EPHEMERAL });
    }

    if (interaction.isButton() && interaction.customId === OPEN_BUTTON_ID) {
      if (interaction.guildId && db.getBan(interaction.guildId, interaction.user.id)) {
        return interaction.reply({ content: 'You are banned from posting in this server.', flags: EPHEMERAL });
      }
      return interaction.showModal(confessModal());
    }

    // "Reply" button under a submission: open the modal aimed at that post.
    if (interaction.isButton() && interaction.customId === REPLY_BUTTON_ID) {
      if (db.getBan(interaction.guildId, interaction.user.id)) {
        return interaction.reply({ content: 'You are banned from posting in this server.', flags: EPHEMERAL });
      }
      const target = db.getConfessionByMessage(interaction.guildId, interaction.message.id);
      if (!target || target.status !== 'posted') {
        return interaction.reply({ content: 'That submission is no longer available to reply to.', flags: EPHEMERAL });
      }
      return interaction.showModal(confessModal({ messageId: interaction.message.id, number: target.number }));
    }

    // 👍 👎 ❤️ and poll-option buttons under a submission.
    if (interaction.isButton() && interaction.customId.startsWith(`${REACT_PREFIX}:`)) return handleReactionButton(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(`${VOTE_PREFIX}:`)) return handleVoteButton(interaction);

    // "Report" button under a submission, and its reason pop-up.
    if (interaction.isButton() && interaction.customId === REPORT_BUTTON_ID) return handleReportButton(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${REPORT_MODAL_PREFIX}:`)) return handleReportModal(interaction);

    if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_ID)) {
      await interaction.deferReply({ flags: EPHEMERAL });
      const replyTo = interaction.customId.split(':')[2] ?? null; // "confess:modal:<messageId>"
      const guild = interaction.guild ?? (await client.guilds.fetch(interaction.guildId));
      let image = null;
      const upload = interaction.fields.getUploadedFiles('image')?.first();
      if (upload) {
        const prepared = await prepareImage(upload, uploadLimit(guild));
        if (prepared.error) return interaction.editReply(prepared.error);
        image = prepared.image;
      }
      // Topic is optional; the poll box exists only on new posts (not replies) and turns the post into a poll.
      const tag = interaction.fields.getStringSelectValues('tag')?.[0] ?? null;
      const poll = replyTo ? { options: null } : parsePollOptions(interaction.fields.getTextInputValue('poll'));
      if (poll.error) return interaction.editReply(poll.error);
      const res = await submitConfession(guild, interaction.user.id, interaction.fields.getTextInputValue('text'), replyTo, image, {
        tag,
        pollOptions: poll.options,
      });
      return interaction.editReply(res.ok ? `Posted as **${anonTitle(res.number)}**.` : res.error);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('confess:pick:')) {
      const token = interaction.customId.split(':')[2];
      const entry = pending.get(token);
      if (!entry || entry.userId !== interaction.user.id) {
        return interaction.update({ content: 'That request expired. Send your submission again.', components: [] });
      }
      pending.delete(token);
      const appealing = entry.appealText !== undefined;
      await interaction.update({ content: appealing ? 'Sending your appeal...' : 'Posting...', components: [] });
      const guild = client.guilds.cache.get(interaction.values[0]);
      if (!guild) return interaction.editReply('I can no longer reach that server.');
      if (appealing) return interaction.editReply(await submitBanAppeal(guild, interaction.user, entry.appealText));
      const res = await submitConfession(guild, interaction.user.id, entry.text, null, entry.image);
      return interaction.editReply(
        res.ok ? `Posted as **${anonTitle(res.number)}** in **${guild.name}**.${entry.note ? `\n${entry.note}` : ''}` : res.error,
      );
    }
  } catch (err) {
    console.error('Interaction error:', err);
    const msg = 'Something broke on my side. Try again in a moment.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: msg, components: [] });
      else if (interaction.isRepliable()) await interaction.reply({ content: msg, flags: EPHEMERAL });
    } catch {
      /* interaction already expired */
    }
  }
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
client.login(process.env.DISCORD_TOKEN);
