# Operations

How FairShare's database is checked and backed up, and how to restore it. Everything here runs from
GitHub Actions on a schedule, and each part stays off until you switch it on, so nothing touches a
database that hasn't been set up for it.

**Passwords, connection strings, access keys and the backup passphrase go only into GitHub's
Secrets and the provider dashboards, never into the repository or a chat.** The repository is
public, and so are its Actions logs: the jobs print counts only, never data.

| What                            | Where                                                            | When                               |
| ------------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| Invariant check (Blueprint 9.2) | `.github/workflows/nightly.yml`                                  | Every night, 03:00 India time      |
| Maintenance (forgetting)        | `.github/workflows/nightly.yml`                                  | Every night, 03:00 India time      |
| Database backup                 | `.github/workflows/nightly.yml`                                  | Every night, 03:00 India time      |
| Restore test                    | `.github/workflows/restore-test.yml`                             | 1 January, April, July and October |
| Scripts behind them             | `scripts/backup/`, `packages/db/src/scripts/check-invariants.ts` | Also runnable by hand              |

GitHub emails a failed scheduled run to whoever last changed the workflow file. That email is the
alert: a failure means look today.

## 1. The nightly invariant check

It reads the database for anything that should be impossible: a transaction whose payers or shares
don't add up to its amount (I1–I3), a group whose balances don't sum to zero (I6), and a live
transaction written after someone in it left the group (I8). In a correct system all three are
always zero.

### Set it up

1. **A read-only login.** In Neon, open the **SQL Editor** on the branch to check (database
   `neondb`) and run, with a password made by `openssl rand -hex 24`:

   ```sql
   CREATE ROLE fairshare_invariants LOGIN PASSWORD '<the password>' IN ROLE fairshare_readonly;
   ```

   `fairshare_readonly` (migration 0003) can read every table and write nothing. Neon doesn't show
   a password set with SQL, so build the connection string yourself: the branch's **direct** (not
   `-pooler`) host, user `fairshare_invariants`, database `neondb`, `?sslmode=require`.

2. **GitHub** (Settings → Secrets and variables → Actions):
   - Secret `INVARIANTS_DATABASE_URL`: that connection string.
   - Variable `INVARIANT_CHECK_ENABLED`: `true`.

3. **Try it now:** Actions → Nightly → Run workflow. The job prints one line such as
   `{"transactionSums":0,"groupNets":0,"inactiveMembers":0,"claimedInSplitInput":0}`.

### When it finds something

The job prints counts only. To see which transactions and groups are involved, run the check
yourself with the same connection string:

```bash
DATABASE_URL='<INVARIANTS_DATABASE_URL>' pnpm --filter @fairshare/db exec tsx src/scripts/check-invariants.ts --details
```

A finding is a bug that got past core, the service and the database's own triggers. Don't edit
the data by hand first. Record what was found, find how it was written (the transaction's history,
`GET /transactions/:id/history`, and the server logs around its `created_at` or `updated_at`), and
fix the cause.

One exception has a ready repair: `claimedInSplitInput` (I12) counts expenses whose split input
still names a placeholder someone has claimed. The pre-deploy step repairs those on every deploy
(`node dist/migrate.js` prints `Split inputs naming a claimed placeholder: N repaired.`), so a
finding after a deploy means a claim path that skips `rewriteSplitInputs`. To repair without
deploying, run `pnpm --filter @fairshare/api repair:split-inputs` with `MIGRATION_DATABASE_URL`
(the owner role) set.

## 2. Nightly backups

`scripts/backup/backup.sh` runs `pg_dump` (custom format, compressed) in a Postgres 17 container,
so its version matches the server's, and encrypts the dump with AES-256 under a passphrase before
it leaves the runner. `scripts/backup/storage.sh` uploads it to S3-compatible storage, named by
date (`fairshare/2026-11-13T213000Z.dump.gpg`), and deletes backups older than 30 days.

Neon also keeps its own history (point-in-time restore, within your plan's retention window).
These backups are the second copy: outside Neon, kept for 30 days, and tested.

### Set it up

1. **Storage.** Cloudflare R2 works well (10 GB free, no charge for downloads); Backblaze B2 or
   AWS S3 work the same way.
   - Create a bucket, e.g. `fairshare-backups`. Keep it private.
   - Create an API token limited to that bucket, with object read and write. Note its access key
     ID and secret access key.
   - The S3 endpoint is shown with the bucket, e.g. `https://<account id>.r2.cloudflarestorage.com`.

2. **A passphrase.** Make one with `openssl rand -base64 32` and **store a copy in your password
   manager first**. Without it no backup can ever be restored, and GitHub won't show a secret
   again once saved.

3. **GitHub** (Settings → Secrets and variables → Actions):

   | Kind     | Name                          | Value                                                         |
   | -------- | ----------------------------- | ------------------------------------------------------------- |
   | Secret   | `BACKUP_DATABASE_URL`         | Neon's `neondb_owner` string, **direct** host (not `-pooler`) |
   | Secret   | `BACKUP_PASSPHRASE`           | The passphrase                                                |
   | Secret   | `BACKUP_S3_ACCESS_KEY_ID`     | The token's access key ID                                     |
   | Secret   | `BACKUP_S3_SECRET_ACCESS_KEY` | The token's secret access key                                 |
   | Variable | `BACKUP_S3_BUCKET`            | `fairshare-backups`                                           |
   | Variable | `BACKUP_S3_ENDPOINT`          | The S3 endpoint                                               |
   | Variable | `BACKUPS_ENABLED`             | `true`                                                        |

   The owner is needed because `pg_dump` also reads sequences and Drizzle's migration table, which
   `fairshare_readonly` can't.

4. **Try it now:** Actions → Nightly → Run workflow, then Actions → Restore test → Run workflow.
   The restore test should end with `Restore check passed.`

## 3. The restore test

Every quarter (or by hand), `.github/workflows/restore-test.yml` downloads the newest backup and
runs `scripts/backup/restore-check.sh`, which restores it into a throwaway Postgres 17 and checks
that:

- the restore finished with no errors;
- every migration in the code is in the backup;
- every trigger came back (the ledger checks and the append-only activity log);
- the invariant check finds nothing.

It prints each table's row count, which you can compare with the live database.

## 4. Restoring for real

If the database is lost or damaged and Neon's own point-in-time restore can't help:

1. **Stop writes.** In Railway, scale the service to zero, so nothing writes while you restore.
2. **Get the backup** from the bucket (the newest, or the last one before the damage).
3. **Restore into a new, empty database** (in Neon, a new branch or project; Postgres 17). As its
   owner, create the two group roles first, since roles aren't in a dump:

   ```sql
   CREATE ROLE fairshare_app NOLOGIN;
   CREATE ROLE fairshare_readonly NOLOGIN;
   ```

   Then decrypt and restore (Docker, so the tools are version 17):

   ```bash
   gpg --decrypt fairshare-2026-11-13T213000Z.dump.gpg |
     docker run --rm -i -e DATABASE_URL postgres:17-alpine \
       sh -c 'pg_restore --no-owner --exit-on-error -d "$DATABASE_URL"'
   ```

   with `DATABASE_URL` set to the new database's owner string. gpg asks for the passphrase.

4. **Re-create the logins** in the new database: `fairshare_api` (the app) and
   `fairshare_invariants` (the nightly check), as in
   [deploy-staging.md](deploy-staging.md#1-neon-database) and section 1 above.
5. **Check it:** run the invariant check with `--details` against the new database. Every count
   must be zero.
6. **Point the app at it:** update `DATABASE_URL` and `MIGRATION_DATABASE_URL` in Railway, and
   the GitHub secrets. Scale back to one replica. The pre-deploy migration step is a no-op on a
   restored database, apart from its split-input repair, which fixes any claims older than that
   repair if the backup predates it.
7. **Sessions:** they're in the database, so people stay signed in unless the backup is older than
   their last sign-in.

Anything written between the backup and the failure is lost. Note when that window was, so people
can re-enter what's missing.

## 5. Restore drill record

| Date       | Source                                    | Result                                                                                                                                                                                                                                                                                           |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-13 | Local copy (the end-to-end test database) | Backed up, encrypted, uploaded to S3-compatible storage (SeaweedFS), pruned (a planted 40-day-old backup deleted, the new one kept), downloaded, restored. 4 of 4 migrations, all 5 triggers, invariants clean, every table's row count identical to the source. A wrong passphrase was refused. |

Add a row after each quarterly restore test, and after the first one against production.

## 6. Nightly maintenance

It forgets what the privacy notice promises to forget: the sentences people typed for an AI
provider to read (`ai_requests.input_text`), 30 days after they were sent. Account deletion clears a
person's sentences at once; this catches everyone else's. It prints one line such as
`{"ranAt":"…","aiInputsPurged":3}`.

### Set it up

1. **A login that may update those rows.** In Neon's SQL Editor (database `neondb`), with a new
   password from `openssl rand -hex 24`:

   ```sql
   CREATE ROLE fairshare_maintenance LOGIN PASSWORD '<the password>' IN ROLE fairshare_app;
   ```

   The connection string: the branch's **direct** host, user `fairshare_maintenance`, database
   `neondb`, `?sslmode=require`.

2. **GitHub:** secret `MAINTENANCE_DATABASE_URL` (that string) and variable
   `MAINTENANCE_ENABLED` = `true`.

3. **Try it now:** Actions → Nightly → Run workflow, and check the Maintenance job's line. By hand:
   `pnpm --filter @fairshare/db maintenance` with `DATABASE_URL` set.

Until it's on, sentences older than 30 days aren't forgotten, which breaks the privacy notice: turn
it on together with the AI provider.

## 7. Typed entry's AI providers

Sentences the rule-based parser can't fully read go to Groq, then Cloudflare Workers AI
(ARCHITECTURE.md, "The LLM path"). Without `AI_PRIMARY_API_KEY` that path is simply off: the form
opens with what the rules found.

### Set it up

1. **Groq:** at [console.groq.com](https://console.groq.com) create an API key, and under
   **Settings → Data Controls** turn on **Zero Data Retention**, so Groq keeps no inputs even for its
   30-day abuse logs. On the **Limits** page, note the text model's tokens per day.
2. **Cloudflare (optional fallback):** in the dashboard, **AI → Workers AI**: note the account ID and
   create an API token with Workers AI permission. Its free allowance is 10,000 neurons a day.
3. **Railway's service variables** (copy the names and defaults from `.env.example`):
   `AI_PRIMARY_API_KEY`, `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_TEXT_MODEL`,
   `AI_PRIMARY_DAILY_TOKENS` (about 80% of the model's free tokens per day), and for Cloudflare
   `AI_FALLBACK_API_KEY`, `AI_FALLBACK_BASE_URL`
   (`https://api.cloudflare.com/client/v4/accounts/<account ID>/ai/v1`) and
   `AI_FALLBACK_TEXT_MODEL`.
4. **Score the model before turning it on** (below), then turn on the nightly maintenance (section
   6), which the privacy notice relies on.

### Changing the prompt or the model

A model can be retired at short notice (Groq retired `qwen3.6-27b` in September 2026). To move to
another model, or after any change to `modules/ai/prompts/`:

1. Put the new model in `.env` locally and run `pnpm --filter @fairshare/api eval:parse` (and
   `-- --provider fallback` for Cloudflare). It reads 105 sentences, takes about 15 minutes at the
   free tier's pace and costs about 105,000 tokens: half of Groq's free day, so run it when the app
   is quiet.
2. It prints accuracy per field and the release gate's verdict: amounts ≥ 95%, people ≥ 90%,
   payer ≥ 90%, split method ≥ 90%. Below the gate, don't ship it: adjust the prompt (as a new
   version, `parse-expense.v2.ts`) or choose another model.
3. Commit the snapshot it saves under `apps/api/src/modules/ai/eval/snapshots/`: CI keeps
   checking it whenever core or the scorer changes.
4. Change the model variable in Railway. No deploy of code is needed.

### When something's wrong

- **Every sentence falls back:** check the API logs for provider errors (`an AI provider failed`)
  and `ai_requests.outcome` (`error`, `timeout`, `rate_limited`, `invalid_output`). A key revoked or
  a model retired shows as `error`; a model whose answers stopped matching the schema shows as
  `invalid_output`.
- **Stop it at once:** set `AI_ENABLED=false`. Typed entry keeps working with the rules alone.
- **How it's doing:** `ai_requests` rows by outcome and provider, and the share of `ok` requests that
  an expense points back to (`transactions.ai_request_id`).

## 8. Other settings

- **Privacy contact.** `/privacy` and `/terms` show `VITE_CONTACT_EMAIL` if it's set (a Docker
  build argument; set it in Railway's service variables, which Railway passes to the build), and
  otherwise the project's GitHub page. Set it before the app is public: privacy requests need a
  private address.
