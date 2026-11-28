# Moving the database to Supabase

**Where things stand:** the repository has the Postgres schema and the tools to fill it. The bot itself still reads and
writes SQLite (`data/confessions.db`). Setting `DATABASE_URL` changes nothing for the running bot until `src/db.js` and
its callers are rewritten for Postgres. Do parts 1 to 4 now, and part 5 only after that rewrite.

| File | What it is |
|---|---|
| `supabase/migrations/*.sql` | The Postgres schema, one file per change |
| `scripts/migrate.js` | `npm run db:migrate` applies new files, `npm run db:status` lists them |
| `scripts/copy-to-postgres.js` | `npm run db:copy` fills an empty Postgres database from SQLite |
| `scripts/pg-client.js` | The connection, with certificate checking |

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

This checks that your real data fits the new schema, and keeps nothing.

1. Move the local `data` folder somewhere else if it exists (for example rename it to `data-dev`).
2. Put the **same** `DISCORD_TOKEN`, `BACKUP_CHANNEL_ID` and `BACKUP_PASSPHRASE` as Render into `.env`.
3. Download the newest backup. This does not start the bot:

```powershell
npm run db:pull
```

It prints `Backup restore: restored ...`. No output means a backup setting is missing or `data/confessions.db` already
exists. Do not run `npm start` with the live token: that is a second copy of the bot.

4. Run the dry run:

```powershell
npm run db:copy -- --dry-run
```

It lists a row count per table and ends with `Dry run passed`.

5. The `data` folder now holds real sender IDs. Delete it when you are done, and rename `data-dev` back.

If the backup channel reported that images were left out (database larger than the upload limit), the backup does not
hold them. Copy from the database file on the server instead: `npm run db:copy -- --sqlite <file>`.

## Connecting Render

Render needs no integration or add-on: the bot only needs two settings. You can add them now or at cut-over.

1. Render service > **Environment** > **Secret Files** > add the certificate, using the same file name.
2. **Environment Variables** > add `DATABASE_URL` (same value as in `.env`).
3. Add `DATABASE_CA_CERT` = `/etc/secrets/<certificate file name>`.
4. Save. Render redeploys, and the bot keeps using SQLite.

Supabase accepts connections from any address unless you add **Network Restrictions**.

## 5. Cut-over (after the code rewrite)

1. Run `/mod pause` with mode `closed`, so nothing new is saved. Wait a minute and check a fresh backup appeared.
2. Suspend the Render service.
3. Repeat part 4, then run the copy without `--dry-run`:

```powershell
npm run db:copy
```

4. Deploy the Postgres version of the bot with the two settings above, and resume the service.
5. Check `/setup view`, post a test submission, and run `/mod resume`.
6. Keep the last SQLite backup until you are sure. To go back, deploy the previous version: it restores from the backup
   channel. Posts made after the cut-over would not be in it.
7. Delete the local `data` folder.

Before cut-over, also decide:

- **Backups.** The free plan has none, and the Discord backup only handles SQLite. Plan a scheduled `pg_dump`.
- **Space.** The free plan holds 500 MB, and images are stored in the database.
- **Privacy page.** Update the backup and hosting wording in `src/lib/legal.js`.

## Changing the schema later

Add a new file in `supabase/migrations/` named `YYYYMMDDHHMMSS_what_changed.sql`, then run `npm run db:migrate`. Never
edit a file that has been applied. Enable row level security on any new table:

```sql
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;
```

Until the rewrite is done, a schema change in `src/db.js` also needs a migration here, and the new `user_version` and
table list in `scripts/copy-to-postgres.js`.
