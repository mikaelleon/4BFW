// Every table that holds the bot's data, for backups, restores and the one-time SQLite copy. Add new tables here.
export const TABLES = [
  'guilds', 'confessions', 'confession_images', 'warnings', 'bans', 'reports', 'mod_notes', 'tag_channels', 'reactions',
  'poll_options', 'poll_votes', 'appeals', 'ban_appeals', 'filter_rules', 'user_prefs', 'thread_aliases', 'meta', 'dm_cursor',
];

/** Tables whose `id` comes from a sequence: it must continue after the highest id ever used. */
export const WITH_IDENTITY = ['confessions', 'warnings', 'mod_notes', 'ban_appeals', 'filter_rules'];
