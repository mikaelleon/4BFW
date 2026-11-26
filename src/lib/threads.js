// Reply threads under submissions (/setup threads). Replies are posted by the bot, so they are as anonymous as posts.
// Inside one thread a person keeps the same alias ("Anon 2"); the post's author may choose to appear as "OP".
import { PermissionFlagsBits, ThreadAutoArchiveDuration } from 'discord.js';
import * as db from '../db.js';
import { anonRef } from './format.js';

export const THREAD_PERMS = [PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads];

/** A channel or thread by id, reopened first when it is an archived thread (nothing in it can change otherwise). */
export async function openChannel(guild, id) {
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel?.isThread?.() && channel.archived) await channel.setArchived(false).catch(() => {});
  return channel;
}

/** The reply thread of a published post, created when it has none yet. Returns { thread } or { error }. */
export async function ensureThread(guild, root) {
  if (root.thread_id) {
    const existing = await openChannel(guild, root.thread_id);
    if (existing) return { thread: existing };
  }
  const channel = await guild.channels.fetch(root.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(root.message_id).catch(() => null);
  if (!message) return { error: 'That submission is no longer available to reply to.' };
  try {
    // A thread started from a message has the message's id: reuse one somebody already opened by hand.
    const thread =
      (message.hasThread ? await openChannel(guild, message.id) : null) ??
      (await message.startThread({ name: `Replies to ${anonRef(root.number)}`, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek }));
    db.setThread(root.id, thread.id);
    return { thread };
  } catch (err) {
    console.error('Could not open a reply thread:', err.message);
    return { error: 'I cannot open a reply thread there. Tell an admin to run `/setup doctor`.' };
  }
}

/** Close the thread under a post that was deleted. Best effort: new replies are refused either way. */
export async function closeThread(guild, row) {
  if (!row.thread_id) return;
  const thread = await guild.channels.fetch(row.thread_id).catch(() => null);
  await thread?.setArchived(true).catch(() => {});
}
