# Moving the database to Supabase

The bot stores everything in Postgres. If a server still runs the older SQLite version, do parts 1 to 4 first, then the
cut-over in part 5. A brand new installation only needs parts 1 to 3 and the Render settings.

| File | What it is |
|---|---|
| `supabase/migrations/*.sql` | The database schema, one file per change |
| `npm run db:migrate`, `npm run db:status` | Apply new schema files, or list them |
| `npm run db:pull`, `npm run db:copy` | One time: download the old SQLite backup and copy it into Postgres |
| `npm run db:restore` | Put a Postgres backup into an empty database |

## 1. Create the Supabase project

1. In Render, open your service and note its **region**.
2. Sign in at [supabase.com](https://supabase.com) and choose **New project**.
3. Pick the region closest to the Render service (Southeast Asia (Singapore) if Render is in Singapore). A distant
   region makes every command slower, and Discord expects a reply within 3 seconds.
4. Generate a strong database password and save it in a password manager.

## 2. Get the connection details

1. On the project page press **Connect** and copy the **Session pooler** connection string (port `5432`, host ending in
   `pooler.supabase.com`). The "Direct connection" string needs IPv6, which Render may not reach.
2. Replace `[YOUR-PASSWORD]` with the password. Percent-encode special characters (`@` is `%40`, `#` is `%23`,
   `/` is `%2F`, `:` is `%3A`).
3. Go to **Project Settings > Database > SSL Configuration** and download the certificate. Save it in the project folder;
   `*.crt` files are ignored by git.
4. Optional, recommended: turn off the **Data API** in the project's API settings. The bot does not use it. The migration
   already blocks it from the tables.

Add to `.env` (never commit this file):

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres
DATABASE_CA_CERT=./prod-ca-2021.crt
```

Use the file name of the certificate you downloaded.

## 3. Create the tables

```powershell
npm install
```

```powershell
npm run db:migrate
```

```powershell
npm run db:status
```

Every file should show `applied`. In Supabase's **Table Editor** the tables appear, each with row level security on.

## 4. Rehearse the data copy

This checks that your real data fits the new schema, and keeps nothing. Do it while the old bot is still running.

1. Move the local `data` folder somewhere else if it exists (for example rename it to `data-dev`).
2. Put the **same** `DISCORD_TOKEN`, `BACKUP_CHANNEL_ID` and `BACKUP_PASSPHRASE` as Render into `.env`.
3. Download the newest SQLite backup. This does not start the bot:

```powershell
npm run db:pull
```

It prints `Backup restore: restored ...`. Do not run `npm start` with the live token: that is a second copy of the bot.

4. Run the dry run:

```powershell
npm run db:copy -- --dry-run
```

It lists a row count per table and ends with `Dry run passed`.

5. The `data` folder now holds real sender IDs. Delete it when you are done, and rename `data-dev` back.

If the backup channel reported that images were left out (database larger than the upload limit), the backup does not
hold them. Copy from the database file on the server instead: `npm run db:copy -- --sqlite <file>`.

## Connecting Render

Render needs no integration or add-on: the bot only needs two settings. **The new version does not start without them.**

1. Render service > **Environment** > **Secret Files** > add the certificate, using the same file name.
2. **Environment Variables** > add `DATABASE_URL` (same value as in `.env`).
3. Add `DATABASE_CA_CERT` = `/etc/secrets/<certificate file name>`.

Supabase accepts connections from any address unless you add **Network Restrictions**.

## 5. Cut-over

Pick a quiet time. The bot is offline for part of it.

1. While the old bot runs, run `/mod pause` with mode `closed`. Wait a minute and check that a fresh backup appeared in
   the backup channel.
2. **Suspend** the Render service, so nothing changes any more and the new code cannot deploy early.
3. Delete the local `data` folder if there is one, then run these one at a time. Stop if one fails:

```powershell
npm run db:migrate
```

```powershell
npm run db:pull
```

```powershell
npm run db:copy -- --dry-run
```

```powershell
npm run db:copy
```

4. Add the Render settings above, if you have not yet.
5. Merge the Postgres version into the branch Render deploys, then resume the service and deploy it.
6. Register the changed slash commands (`/setup options` has a new `image_days` option):

```powershell
npm run deploy
```

7. Check `/setup doctor` and `/setup view`, then `/mod resume`, and post a test submission.
8. Delete the local `data` folder. Keep the last SQLite backup in the channel until you are sure.

**Going back:** deploy the previous version again. It reads the SQLite backup from the channel. Anything posted after the
cut-over is not in it. Do not use `/clearchannels backup` until you no longer need to go back: it removes older backups.

## Backups

With `BACKUP_CHANNEL_ID` and `BACKUP_PASSPHRASE` set, the bot uploads an encrypted copy of the database once a day and
keeps the newest 10. Images are left out as needed to fit Discord's upload limit. Up to a day of changes can be lost, and
the backup channel is the only copy on the free plan. Reading the database for a backup counts toward Supabase's
monthly data transfer.

To restore into a new, empty database: set `DATABASE_URL` to it, then:

```powershell
npm run db:migrate
```

```powershell
npm run db:restore -- --dry-run
```

```powershell
npm run db:restore
```

## Staying inside the free plan

- The free plan holds 500 MB, and images are stored in the database. `/setup options image_days:90` deletes stored
  images of finished posts older than 90 days and keeps every other record.
- Supabase pauses a free project after a week without activity. A running bot queries it every minute; if the bot was
  off for longer, resume the project in the dashboard.
- Put the database near the Render service. Every command waits for it, and Discord expects an answer within 3 seconds.

## Changing the schema later

Add a new file in `supabase/migrations/` named `YYYYMMDDHHMMSS_what_changed.sql`, then run `npm run db:migrate` before
deploying the code that needs it. The bot refuses to start while a file is not applied. Never edit a file that has been
applied. Enable row level security on any new table, and add the table to `src/lib/tables.js`:

```sql
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;
```
