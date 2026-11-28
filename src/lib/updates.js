// The latest commits shown on the home page, read from GitHub's public API by the server (visitors never contact GitHub).
// Cached for ten minutes, which stays far below the limit for requests without a token. A failed read keeps the last
// good list.
const REPO = (process.env.GITHUB_REPO || 'mikaelleon/4BFW').trim();
const CACHE_MS = 10 * 60_000;
const SHOWN = 8; // three in view, the rest behind a row that wide screens open to fill the column
const MAX_TITLE = 120;

export const repoUrl = `https://github.com/${REPO}/commits`;

let cached = null;
let readAt = 0;
let reading = null;

/** "refactor(ui): tidy the page" -> "Tidy the page": the first line, without the commit-type prefix. */
export function updateTitle(message) {
  const line = String(message).split('\n')[0].trim();
  const plain = line.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '') || line;
  const title = plain.charAt(0).toUpperCase() + plain.slice(1);
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
}

async function read() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=${SHOWN}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'stfw-bot' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return (await res.json()).map((c) => ({ title: updateTitle(c.commit.message), date: c.commit.committer.date, url: c.html_url }));
}

/** -> [{ title, date, url }], newest first, or null when GitHub has never answered. */
export async function latestUpdates() {
  if (Date.now() - readAt < CACHE_MS) return cached;
  reading ??= read()
    .then((list) => {
      cached = list;
    })
    .catch((err) => console.error('Could not read the latest updates:', err.message))
    .finally(() => {
      readAt = Date.now();
      reading = null;
    });
  await reading;
  return cached;
}
