import { PermissionFlagsBits } from 'discord.js';
import { getGuild } from '../db.js';

/**
 * Moderator = Manage Server, or holds the role set with `/setup modrole`.
 * Works with a cached GuildMember or the raw member object attached to an interaction.
 */
export function isModerator(member, permissions, cfg) {
  if (permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!cfg?.mod_role_id || !member) return false;
  const roles = member.roles;
  return Array.isArray(roles) ? roles.includes(cfg.mod_role_id) : Boolean(roles?.cache?.has(cfg.mod_role_id));
}

async function memberIn(guild, userId) {
  return guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
}

/**
 * Guilds (that the bot is in) relevant to this user.
 * admin=true  -> guilds where the user is a moderator (Manage Server or the mod role)
 * admin=false -> guilds where submissions are set up and the user is a member
 */
export async function candidateGuilds(client, userId, { admin = false, manageOnly = false } = {}) {
  const out = [];
  for (const guild of client.guilds.cache.values()) {
    const member = await memberIn(guild, userId);
    if (!member) continue;
    if (admin) {
      // manageOnly: configuration commands, which the moderator role cannot use
      const allowed = manageOnly
        ? member.permissions.has(PermissionFlagsBits.ManageGuild)
        : isModerator(member, member.permissions, await getGuild(guild.id));
      if (!allowed) continue;
    } else if (!(await getGuild(guild.id))?.channel_id) {
      continue;
    }
    out.push(guild);
  }
  return out;
}

/**
 * Work out which server a command applies to.
 * In a server: that server. In DMs: the only matching server, or the one given in the `server` option.
 */
export async function resolveGuild(interaction, { admin = false, manageOnly = false } = {}) {
  if (interaction.inGuild()) {
    const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId));
    if (admin && manageOnly && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return { error: 'You need the **Manage Server** permission for this.' };
    }
    if (admin && !manageOnly && !isModerator(interaction.member, interaction.memberPermissions, await getGuild(guild.id))) {
      return { error: 'You need the **Manage Server** permission or the moderator role for this.' };
    }
    if (!admin && !(await getGuild(guild.id))?.channel_id) {
      return { error: 'Submissions are not set up in this server yet. Ask an admin to run `/setup channel`.' };
    }
    return { guild };
  }

  const options = await candidateGuilds(interaction.client, interaction.user.id, { admin, manageOnly });
  const wanted = interaction.options.getString('server');
  if (wanted) {
    const guild = options.find((g) => g.id === wanted);
    return guild ? { guild } : { error: 'I could not match that server. Pick one from the `server` list.' };
  }
  if (options.length === 1) return { guild: options[0] };
  if (options.length === 0) {
    return {
      error: admin
        ? `I found no server I am in where you have **Manage Server**${manageOnly ? '' : ' or the moderator role'}.`
        : 'I found no server you are in that has submissions set up.',
    };
  }
  return { error: 'You share several servers with me. Pick one with the `server` option.' };
}

export async function serverAutocomplete(interaction, { admin = false, manageOnly = false } = {}) {
  const typed = interaction.options.getFocused().toLowerCase();
  const guilds = await candidateGuilds(interaction.client, interaction.user.id, { admin, manageOnly });
  await interaction.respond(
    guilds
      .filter((g) => g.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((g) => ({ name: g.name.slice(0, 100), value: g.id })),
  );
}
