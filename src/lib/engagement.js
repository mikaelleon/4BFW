// Button reactions (👍 👎 ❤️) and poll votes under submissions. One choice per person, clicking it again withdraws it.
// Nobody sees who voted: the user id is stored only to enforce the one-vote rule.
import { MessageFlags } from 'discord.js';
import * as db from '../db.js';
import { MAX_POLL_OPTIONS, postComponents } from './confession.js';

export const MAX_OPTION_LEN = 40;
const KINDS = new Set(['up', 'down', 'heart']);

/** Poll options typed by a user (one per line, or split by `|` for the slash command). Empty = not a poll. */
export function parsePollOptions(text, separator = /\r?\n/) {
  const raw = (text ?? '').trim();
  if (!raw) return { options: null };
  const options = raw
    .split(separator)
    .map((o) => o.trim())
    .filter(Boolean);
  if (options.length < 2 || options.length > MAX_POLL_OPTIONS) return { error: `A poll needs 2 to ${MAX_POLL_OPTIONS} options.` };
  if (options.some((o) => o.length > MAX_OPTION_LEN)) return { error: `Each poll option can be at most ${MAX_OPTION_LEN} characters.` };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { error: 'Poll options must all be different.' };
  return { options };
}

const gone = (interaction) =>
  interaction.reply({ content: 'That submission is no longer available.', flags: MessageFlags.Ephemeral });

function targetOf(interaction) {
  if (!interaction.inGuild()) return null;
  const target = db.getConfessionByMessage(interaction.guildId, interaction.message.id);
  return target && target.status === 'posted' ? target : null;
}

export async function handleReactionButton(interaction) {
  const kind = interaction.customId.split(':')[2];
  const target = targetOf(interaction);
  if (!target || !KINDS.has(kind)) return gone(interaction);
  db.toggleReaction(target.id, interaction.user.id, kind);
  return interaction.update({ components: postComponents(target) });
}

export async function handleVoteButton(interaction) {
  const idx = Number(interaction.customId.split(':')[2]);
  const target = targetOf(interaction);
  if (!target || !target.is_poll || !db.getPollOptions(target.id).some((o) => o.idx === idx)) return gone(interaction);
  db.togglePollVote(target.id, interaction.user.id, idx);
  return interaction.update({ components: postComponents(target) });
}
