# Confessions Bot

Anonymous submissions (freedom wall) bot for Discord. Node 22.13+ (uses built-in `node:sqlite`, no native deps).

## Setup

1. Discord Developer Portal -> New Application -> Bot. Copy the **token**.
2. Bot tab -> enable **Server Members Intent** (needed for `/announce`, welcome DMs, and membership checks).
3. Invite the bot (replace `YOUR_CLIENT_ID`). The permission set covers viewing, sending, embeds, files, message history, and reply threads:
   `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=309237763072`
4. `copy .env.example .env`, then fill `DISCORD_TOKEN` and `CLIENT_ID`.
5. `npm install`, then `npm run deploy` (registers slash commands), then `npm start`.
   - Leave `DEV_GUILD_ID` empty for global commands (required for DM use, up to ~1h to propagate).
   - Set it to your server ID to test instantly (guild commands do not work in DMs).
6. In your server: `/setup channel #confessions`. Deny **Send Messages** for @everyone in that channel so only the bot posts.

| `.env` | Required | What it does |
|---|---|---|
| `DISCORD_TOKEN`, `CLIENT_ID` | yes | Login and command registration |
| `DEV_GUILD_ID` | no | Guild-only command deploy for testing |
| `BOT_PREFIX` | no | DM prefix (default `fw`) |
| `TIMEZONE` | no | Footer dates (default `Asia/Manila`) |
| `ID_HASH_SECRET` | no | Pins the hash key for bans and warnings. Set it once; never change it |
| `BACKUP_CHANNEL_ID`, `BACKUP_PASSPHRASE` | no | Encrypted DB backups to a private channel, shortly after changes. Both required. If the database outgrows the upload limit, images are left out of the backup (never records); failures are posted in that channel |
| `PORT` | no | HTTP keep-alive (default `3000`) |

## Sending a submission

| Way | How |
|---|---|
| Slash command | `/fw` in any server channel or in the bot's DMs. The reply is ephemeral. |
| Button | **Write a Submission** stays at the bottom of the channel (reposted after each post) and opens a pop-up. |
| DM | `fw <text>` (prefix from `BOT_PREFIX`). If you share several servers with the bot, it asks which. DMs sent while the bot was offline are picked up on startup (up to 24 hours). |

Optional on `/fw` and in the pop-up: a **topic**, one **image** (PNG, JPG, GIF, or WEBP), a **content warning**, and a **poll**. Text can be empty when an image is attached. The image is re-uploaded by the bot, so the size cap is the server's Discord upload limit (10 MB, or 50 / 100 MB if the server is boosted). The original filename is dropped.

DM extras, in this order: `fw #memes <message>`, `fw cw: spoilers | <message>`, `fw poll 24h: Question? | Option A | Option B` (the `24h` is optional; no options means yes/no). The same exist as `/fw` options. `fw notify off` stops reply DMs. `fw preview on` shows the post and asks before it goes up.

Posts are titled `Anonymous #001`. A tagged post gets a random shade of that topic's color; an untagged post gets a random gray. A wide transparent image keeps every post the same width. Replying (the Reply button, or `#012` in the text, up to five) DMs the original author an embed with a link to the reply, never revealing who replied. `/fw notify:off` turns those DMs off. Default cooldown is 30s (`/setup options cooldown`).

Under each post: **Reply**, **Report**, and 👍 👎 ❤️ (one reaction per person; tap again to take it back). Polls use a second row of buttons. A poll is yes/no (`/fw poll:yes/no`, or `fw poll: Question?`) or 2–5 options. It closes after `poll_hours` (per post, or the server default; `0` means until someone closes it) or when the author or a moderator presses **Close poll**. A results card is posted as a reply.

**Report** asks for an optional reason. Reports are anonymous: the mod log shows a count and the reason, never who reported. Each person can report a post once. At `/setup options report_limit` (default 3, `0` = never) the post is hidden until a moderator restores or deletes it.

Topics (also `#key` in DMs): Confessions, Crush / Love, Rants & Vents, Shoutouts, Campus Life, Academics, Questions, Lost & Found, Events, Org & Department, Memes, Random, Suggestions, Mental Health, Open Letters. `/setup tagchannel` sends one topic to its own channel. The button stays in the main channel.

## Reply threads

Off by default. With `/setup threads enabled:true` every new post gets a thread, and **Reply** posts into it through the bot. Older posts get a thread at their first reply. The bot needs **Create Public Threads** and **Send Messages in Threads** (an existing invite may lack them).

- A person keeps one alias per thread (`Anon 1`, `Anon 2`…, numbered by first reply). Aliases differ between threads. Anyone can therefore tell which replies in one thread came from the same person.
- Only the author of the post is offered **Reply as OP**, off unless chosen. Without threads, the same choice adds `OP` to a channel reply.
- Each reply is a normal submission: it takes the next public number and a Submission ID, passes the filter, cooldown, caps and approval queue, and has Report and 👍 👎. It is not featured or highlighted.
- Deleting a post archives its thread and refuses new replies; replies already there stay until deleted one by one. Locking a thread in Discord stops bot replies too.
- People can still type in a thread under their own name. Deny **Send Messages in Threads** for @everyone to allow only anonymous replies.

## Confession number vs Submission ID

| | Public number | Submission ID |
|---|---|---|
| Shown to | everyone (`Anonymous #012`) | moderators (mod-log title, `/mod`) |
| Unique | no, restarts after `/setup reset_count` | yes, per server, never reused |
| Used for | display and `#012` links | every `/mod` command and `/sender` |

**Sender IDs are never shown** in the mod log or `/mod history`. Only the server owner can look one up: `/sender id:<Submission ID>` asks for the owner's 6-digit PIN (60 seconds, 3 wrong tries lock it for 10 minutes) and answers with a private, dismissable message. The PIN is generated at the first `/setup channel` and DMed to the owner; change it with `/ownerpin`. Only a hash is stored, so a lost PIN cannot be recovered (clear `owner_pin` in the `guilds` table to start over).

Moderators find the Submission ID in the mod-log title, via right-click on the message -> Apps -> **Submission ID**, or `/mod info`. Set a log channel with `/setup modlog`.

`/guide` lets anyone re-read the guide.

## Admin commands

Need **Manage Server** unless noted. They work in a server or in the bot's DMs. In DMs, pass `server` (autocompletes) when you manage more than one server, and use `channel_id` / `role_id` instead of the pickers.

`/setup`:

- `channel` — submissions channel and the button message
- `modlog` — moderation log (omit the channel to clear)
- `role` — role that `/announce` DMs the guide to
- `onlinerole` — role that gets a DM when the bot comes online (at most once every 30 minutes)
- `modrole` — role that can use mod-log buttons, `/mod`, and **Submission ID** without Manage Server
- `options` — cooldown, warn limit and expiry, report limit, self-delete window, retention, approval queue, default poll length, join age, account age, daily cap, repost window, welcome DM
- `reset_count confirm:true [start_at]` — restart public numbering. Old posts keep their Submission IDs
- `tagchannel` — route one topic to its own channel
- `highlights` — post the most-liked submission of the day, the week, or both (rolling 24h / 7 days from when it was turned on; nothing is posted if nobody liked anything)
- `featured` — copy a post into another channel once it reaches a 👍 threshold (default 5). The copy's counts follow the original, and the copy is removed if the original is deleted or hidden
- `refreshposts [count]` — put the current buttons on the newest posts (default 50)
- `refresh` — repost the button message
- `threads enabled:true|false` — a reply thread under each new post (see Reply threads)
- `quiethours start:23:00 end:05:00` — close submissions and replies at those times every day, in `TIMEZONE` (`off:true` to stop)
- `view` — current settings
- `doctor` — channels, permissions, deleted roles, settings that contradict each other, pending posts, and the ID hash secret

`/filter` (Manage Server): `add` a whole word or phrase (any case) or a regex, `remove`, `list`, `test`, and `settings`. On a hit the post is **rejected**, or **held** in the mod log for approval. Settings can also block Discord invites and/or every link. Authors are told only that something is not allowed, never which rule.

`/announce [role] [everyone]` DMs the guide (throttled; the result is DMed to you). The role defaults to `/setup role`. With no role you must pass `everyone: true`. `/setup options welcome_dm:true` DMs the guide to each new member.

`/cleardms` (server owner only, in the server, asks for the owner PIN) deletes the DMs the bot sent (guide, warnings, notices): `everyone`, a `role`/`role_id`, a `user`, or `user_ids` (IDs or mentions). Only members of the server, only the bot's own messages, with a confirm button. `/clearchannels submissions|modlog|backup` deletes the bot's messages in those channels (the sticky button stays; clearing the backup channel uploads a fresh backup first and deletes the older ones only if that worked). `/clearchannels` needs Manage Server. The result appears as a dismissable message where you ran the command (by DM if the job takes over 15 minutes). After adding them, run `npm run deploy` to register the commands.

`/mod` (Manage Server or the moderator role), all by Submission ID:

- `delete`, `warn` (optional `delete`), `ban` (optional `duration` like `30m`, `12h`, `7d`, `2w`; default also deletes the post), `unban` (clears warnings by default)
- `info`, `history` (that author's posts, warnings, and notes), `note`, `restore` (put back a post that reports auto-hid, and dismiss its reports)

Not tied to one submission:

- `pause [duration] [reason]` and `resume` — stop new submissions and replies for a while. Posts already waiting can still be approved
- `queue` — posts waiting for approval or hidden after reports, oldest first
- `stats [days]` — server totals: posts, replies, topics, reports, warnings, bans, queue
- `search [text] [topic] [status] [days]` — find submissions. There is no search by person

The warn limit (default 3) auto-bans. Warnings older than `warn_expiry_days` (`0` = never) stop counting. Timed bans lift themselves; the user and the mod log are told.

## Mod log

Every new submission is logged with its text, image, jump link, topic, poll marker, public number, and timestamp. The embed title is the Submission ID. There is no sender ID on the entry.

Buttons under an entry: **Warn**, **Delete**, and **Ban** (**Unban** once the author is banned). Warn, Delete, and Ban ask for a preset reason plus optional details; Ban also asks for a duration. **Restore** appears while a post is auto-hidden. The same actions exist as `/mod`.

`/clearwarn user:|user_id: [warning:W-0042|all] [reason:]` (server owner only, asks for the owner PIN) lifts warnings (or, from its pick list, a posting ban) and DMs the user. Without `warning` it shows a private pick list. It is owner-only because a named user's warnings can be matched to mod-log entries.

`/setup modrole` grants those buttons, `/mod`, and **Submission ID**. `/setup`, `/announce`, `/filter`, `/sender`, `/clearwarn`, `/cleardms`, and `/ownerpin` stay restricted (Manage Server, or owner-only for the PIN commands). If `/mod` is hidden from the role, allow it under Server Settings > Integrations. Keep the mod log staff-only: it contains the full text and any image.

`/setup options approval:true` holds new posts in the mod log with **Approve** / **Reject** until a moderator acts. The public number is assigned on approval. Default is off (post first, moderate after), which matches the guide. Filter holds use the same queue.

## Notices and appeals

Warning, ban, and removal DMs share one layout: what happened, the reason, a ~100-character excerpt (public number only), where the user stands, and a **Read the rules** button. Warnings are yellow at 1/3, orange at 2/3, and red at the limit, with a progress bar and an ID like `W-0042`. If warning expiry is on, the DM says so.

- Contest a warning with `/appeal W-0042 [message]`. The mod log (pinging the moderator role) gets **Overturn warning** / **Uphold**. The user is DMed the result.
- Contest a ban by DMing `fw appeal <why>`. The mod log gets **Lift ban** / **Deny**. A denied appeal can be sent again after a week. An open appeal blocks a second one.
- A removal by itself is not a warning. The DM tells the user to message a moderator; there is no appeal command for a deletion.

Authors can right-click their own post > Apps > **Delete my submission** within `self_delete_minutes` (default 10, `0` = off). Anyone else is told it is not theirs.

## Notes

- The bot stores the author ID on each confession so it can DM the author about replies, warnings, and bans. The guide tells users this. Anyone with access to `data/confessions.db` can see it, so protect that file. Backups of that file are encrypted, but they still contain the same data.
- **Hashed IDs:** warnings, bans, notes, votes, and reports are stored under a keyed hash of `server:user`, not the raw Discord ID. Set `ID_HASH_SECRET` and never change it. A different secret makes every stored ban and warning stop matching its user (the bot logs a warning at startup if the secret changed). Without it, the secret is derived from `DISCORD_TOKEN`.
- **Data retention:** `/setup options retention_days:N` erases the sender ID, text, and image of posts older than N days (checked hourly). The Discord message stays. Submission IDs, bans, and warnings keep working. Mod-log messages already posted in Discord are not edited.
- **Anti-abuse** (`/setup options`): `min_join_days`, `min_account_days`, `daily_cap` (posts per person per rolling 24 h), and `dup_hours` (blocks a post that repeats, or nearly repeats, anyone's text from the last N hours; default 24, `0` = off; texts under 12 characters may repeat). The first three are off by default. People are told when they can post again, never why a repost matched.
- A content warning hides the text behind a spoiler under a visible warning line. A picture goes up as a blurred attachment.
- Mass DMs can get a bot flagged by Discord. `/announce` and the online notice are slow on purpose; use them sparingly.
- Mentions in submissions never ping (`allowedMentions` is empty).
