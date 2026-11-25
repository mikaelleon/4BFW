# Confessions Bot

Anonymous confessions (freedom wall) bot for Discord. Node 22.13+ (uses built-in `node:sqlite`, no native deps).

## Setup

1. Discord Developer Portal -> New Application -> Bot. Copy the **token**.
2. Bot tab -> enable **Server Members Intent** (needed for `/announce` and membership checks).
3. Invite the bot (replace `YOUR_CLIENT_ID`):
   `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=19456`
4. `copy .env.example .env`, fill `DISCORD_TOKEN` and `CLIENT_ID`.
5. `npm install`, then `npm run deploy` (registers slash commands), then `npm start`.
   - Leave `DEV_GUILD_ID` empty for global commands (required for DM use, up to ~1h to propagate).
   - Set it to your server ID to test instantly (guild commands do not work in DMs).
6. In your server: `/setup channel #confessions`. Deny **Send Messages** for @everyone in that channel so only the bot posts.

Optional `.env` values: `BOT_PREFIX` (DM prefix) and `TIMEZONE` (IANA name for footer date/time, default `Asia/Manila`).

## Sending a confession

| Way | How |
|---|---|
| Slash command | `/fw message:...` in any server channel or in the bot's DMs. Reply is ephemeral: nothing public is left. |
| Button | "Write a Submission" message is kept at the bottom of the channel (reposted after each post). Opens a pop-up. |
| DM | `fw <text>` (prefix set by `BOT_PREFIX`, default `fw`) or `/fw`. If you share several servers with the bot, it asks which. Attach one image (PNG/JPG/GIF/WEBP, up to 8 MB) to the DM to show it inside the post; text is optional with an image. Images work **only** in this DM method. |

Posts are titled `Anonymous #001`, get a random color each (so neighbours are easy to tell apart) and a fixed width. Replying (Reply button or `#012` in the text) DMs the original author an embed with a link to the reply, never revealing who replied. Default cooldown is 30s (`/setup options cooldown`).

## Admin commands (need Manage Server; work in a server or in the bot's DMs)

In DMs, pass the `server` option (autocompletes) when you manage more than one server, and use `channel_id` / `role_id` instead of the pickers.

- `/setup channel | modlog | role | modrole | options | reset_count | view | refresh`
- `/setup reset_count confirm:true [start_at]` restarts the public numbering (e.g. after moving channels). Old confessions keep their IDs.
- `/announce [role] [everyone]` DMs the guide (throttled, result DMed to you). Role defaults to `/setup role`; with no role you must pass `everyone: true`.
- `/setup options welcome_dm:true` DMs the guide to each new member.
- `/mod delete | warn | ban | unban | info <id>`: act on the **Submission ID**. The mod log shows the sender's user ID (spoilered), so anyone who can read the log channel can identify authors: keep it staff-only. The bot applies the warning/ban to the stored author. Warn limit (default 3) auto-bans.

## Confession number vs Submission ID

| | Public number | Submission ID |
|---|---|---|
| Shown to | everyone ("Anonymous Confession #12") | admins only |
| Unique | no, restarts after `/setup reset_count` | yes, never reused |
| Used for | display | all `/mod` commands |

Admins find the ID in the mod log (every new confession is logged with both), via right-click on the message -> Apps -> **Submission ID**, or `/mod info`. Set a log channel with `/setup modlog`.
- `/guide`: anyone can re-read the guide.

## Notes

- The bot stores the author ID privately per confession (needed to DM the author about warnings and replies). The guide tells users this. Anyone with access to `data/confessions.db` can see it, so protect that file.
- **Hashed IDs:** warnings, bans, notes, votes and reports are stored under a keyed hash of `server:user`, not the raw Discord ID. Set `ID_HASH_SECRET` in `.env` (any long random string) and **never change it**: a different secret makes every stored ban and warning stop matching its user (the bot logs a warning at startup if the secret changed). Without it the secret is derived from `DISCORD_TOKEN`.
- **Data retention:** `/setup options retention_days:N` erases the sender ID, text and image of posts older than N days (checked hourly). The post stays in the channel; IDs, bans and warnings keep working. Mod-log entries already posted in Discord are not touched.
- **Self-delete:** authors can right-click their own post > Apps > **Delete my submission** within `/setup options self_delete_minutes` (default 10, 0 = off).
- **Ban appeals:** a banned user DMs the bot `fw appeal <why>`; the mod log gets the appeal with **Lift ban** / **Deny** buttons.
- `/setup refreshposts [count]` adds the current buttons (Report, reactions, poll) to older posts.
- **Auto-filter** (`/filter`): `add` a word/phrase (whole word, any case) or a regex, `remove`, `list`, `test`, and `settings` to choose what happens on a hit (**reject** the post, or **hold** it in the mod log for a moderator) and to block Discord invites and/or all links. Authors are told only that something is not allowed, never which rule.
- **Approval queue** (`/setup options approval:true`): new posts wait in the mod log with **Approve** / **Reject** buttons and get their public number when approved. Default is off: posts go up first and are moderated afterwards, which is what the guide's rules describe. Filter holds use the same queue.
- **Polls** are yes/no (`/fw poll:yes/no`, or `fw poll: Question?` in DMs; ✅ ❌ buttons) or 2-5 options (numbered 1️⃣-5️⃣ buttons, options listed in the post). They close at their end time (`/fw poll_hours`, or the server default `/setup options poll_hours`, 0 = until closed) or when the author or a moderator presses **Close poll**. A results card is posted as a reply.
- **Featured channel** (`/setup featured channel threshold`): a post with that many 👍 is copied there once; the copy's counters follow, and it is removed if the original is deleted or hidden.
- **DM shortcuts:** `fw #memes <message>`, `fw cw: label | <message>`, `fw poll 24h: Question? | A | B`, `fw notify off`, `fw preview on`. The same exist as `/fw` options.
- **Content warning:** hides the text behind a spoiler under a visible warning line; a picture goes up as a blurred attachment.
- **Reply notifications:** `/fw notify:off` (or `fw notify off`) stops the "someone replied" DMs. **Preview:** `/fw preview:on` shows the post and asks before it goes up.
- Mass DMs can get a bot flagged by Discord. `/announce` is slow on purpose; use it sparingly.
- Mentions in confessions never ping (`allowedMentions` is empty).

## Mod log buttons and the moderator role

Every new submission is logged in the mod-log channel (`/setup modlog`) with its text, jump link, Submission ID, public number, spoilered sender ID and timestamp. Under each entry are **Warn**, **Delete** and **Ban** (**Unban** once the author is banned) buttons. Warn, Delete and Ban ask for an optional reason first; the same actions are available as `/mod` commands.

`/setup modrole @role` lets that role use the buttons, `/mod` and the right-click **Submission ID** command without Manage Server. Setup commands (`/setup`, `/announce`) stay Manage Server only. If `/mod` is hidden from the role, allow it for them under Server Settings > Integrations. Keep the mod-log channel staff-only: it shows sender IDs.

## Moderation notices and appeals

Warning, ban and removal DMs share one layout: what happened, reason, a ~100-character excerpt of the post (public number only, never the admin Submission ID), where the user stands, and what they can do next, with a **Read the rules** button. Warnings are yellow at 1/3, orange at 2/3 and red at the limit, with a progress bar and a warning ID like `W-0042`. If warning expiry is on (`/setup options warn_expiry_days`), the DM says so.

Users contest a warning with `/appeal W-0042 [message]`. The appeal appears in the mod log (pinging the moderator role) with **Overturn warning** / **Uphold** buttons; the user is DMed the result. Bans and removals tell the user to message a moderator (no command for those yet).
