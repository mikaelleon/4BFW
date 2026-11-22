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

- The bot stores the author ID privately per confession (needed for warn/ban). The guide tells users this. Anyone with access to `data/confessions.db` can see it, so protect that file.
- Mass DMs can get a bot flagged by Discord. `/announce` is slow on purpose; use it sparingly.
- Mentions in confessions never ping (`allowedMentions` is empty).

## Mod log buttons and the moderator role

Every new submission is logged in the mod-log channel (`/setup modlog`) with its text, jump link, Submission ID, public number, spoilered sender ID and timestamp. Under each entry are **Warn**, **Delete** and **Ban** (**Unban** once the author is banned) buttons. Warn, Delete and Ban ask for an optional reason first; the same actions are available as `/mod` commands.

`/setup modrole @role` lets that role use the buttons, `/mod` and the right-click **Submission ID** command without Manage Server. Setup commands (`/setup`, `/announce`) stay Manage Server only. If `/mod` is hidden from the role, allow it for them under Server Settings > Integrations. Keep the mod-log channel staff-only: it shows sender IDs.
