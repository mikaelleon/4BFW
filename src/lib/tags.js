// Topics a submission can be filed under. Each has its own embed colour and can be routed to its own channel.

export const TAGS = [
  { key: 'confessions', label: 'Confessions', emoji: '🤫', color: 0x8e6bbf },
  { key: 'crush', label: 'Crush / Love', emoji: '💘', color: 0xe8628b },
  { key: 'rants', label: 'Rants & Vents', emoji: '😤', color: 0xd9534f },
  { key: 'shoutouts', label: 'Shoutouts & Appreciation', emoji: '🌟', color: 0xf0b232 },
  { key: 'campus', label: 'Campus Life', emoji: '🏫', color: 0x3ba55c },
  { key: 'academics', label: 'Academics & Study', emoji: '📚', color: 0x4a90d9 },
  { key: 'questions', label: 'Questions & Advice', emoji: '❓', color: 0x2bb5a6 },
  { key: 'lostfound', label: 'Lost & Found', emoji: '🔎', color: 0xa47b4e },
  { key: 'events', label: 'Events & Announcements', emoji: '📣', color: 0xf57c00 },
  { key: 'orgs', label: 'Org & Department Talk', emoji: '🏛️', color: 0x5865f2 },
  { key: 'memes', label: 'Memes & Humor', emoji: '😂', color: 0xc6d12b },
  { key: 'random', label: 'Random Thoughts', emoji: '💭', color: 0x8a9ba8 },
  { key: 'suggestions', label: 'Suggestions & Feedback', emoji: '💡', color: 0x29b6f6 },
  { key: 'mental', label: 'Mental Health & Support', emoji: '💚', color: 0x7fd1ae },
  { key: 'letters', label: 'Open Letters', emoji: '✉️', color: 0xe07a5f },
];

const BY_KEY = new Map(TAGS.map((t) => [t.key, t]));

/** Tag object for a key, or null (also for unknown / empty keys). */
export const getTag = (key) => (key ? (BY_KEY.get(key) ?? null) : null);

/** "💘 Crush / Love" */
export const tagText = (key) => {
  const t = getTag(key);
  return t ? `${t.emoji} ${t.label}` : null;
};

/** Slash-command choices ({ name, value }). */
export const tagChoices = () => TAGS.map((t) => ({ name: `${t.emoji} ${t.label}`, value: t.key }));
