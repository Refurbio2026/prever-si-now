# Operational Rules for AI Agents

These rules are binding for any AI agent (Claude, Lovable, Codex, etc.)
touching this repository. They exist to prevent outages, data loss, and
silent divergence between the checked-in source and what runs in production.

## 1. Never edit code on the production VM

The production host lives at `/opt/preversi/app` on our self-hosted VM. It is
deployed automatically from the GitHub `main` branch via webhook. **Any local
edit made on the VM is overwritten on the next deploy** and will disappear
without warning.

- Do all code changes in this repo, commit, push, let the webhook deploy.
- Never SSH in and edit files under `/opt/preversi/app` directly.
- If you need to diagnose live state, read logs (`pm2 logs`), inspect the DB,
  or curl the app — do not patch source.

## 2. Never run imports as standalone processes

Global DataHub imports (RPO, VAT, tax debtors, social insurance) MUST run
through one of:

- The admin UI (`/admin/datahub*`)
- The public webhook endpoints under `/api/public/hooks/*`
- The pg_cron jobs that call those endpoints

These paths respect the `datahub_settings.global_import_running` lock, which
prevents concurrent runs from corrupting staging / reconciliation. Running an
importer as an ad-hoc Node script, `bunx tsx …`, or a REPL bypass **will**
double-import, race the lock, and can leave `is_current` rows in an
inconsistent state.

- If you need to trigger a run manually, POST to the appropriate
  `/api/public/hooks/*` endpoint with the `DATAHUB_CRON_SECRET`.
- If the lock is stuck, clear it explicitly via SQL after confirming no
  worker is actually running (`ps -ef | grep node`, `pm2 status`).

## 3. Destructive SQL requires explicit human approval

The Supabase production DB is the source of truth for millions of company
records. Never run `DELETE`, `TRUNCATE`, `DROP`, `UPDATE` without a `WHERE`,
or a schema-altering migration on production without a human explicitly
approving that exact statement in this session.

- Migrations go through `supabase--migration` and pause for approval.
- One-off data fixes: state the SQL, wait for the human to say yes, then run.
- "Cleaning up a few rows" while investigating is still destructive. Ask.

## 4. Verify the import lock before any deploy or restart

A PM2 restart (or a webhook-triggered redeploy) kills whatever the Node
process is currently doing. If a global import is running, the process dies
mid-batch, leaving:

- The lock held (stale, cleared after 30 min)
- Staging tables partially populated
- `is_current` flags in a half-reconciled state

Before triggering a deploy or `pm2 restart`, confirm:

```sql
SELECT global_import_running, global_import_started_at, global_import_current_run_id
FROM public.datahub_settings
WHERE id = true;
```

If `global_import_running = true`, wait for it to finish (or explicitly abort
via the admin UI) before restarting. The RPO init alone takes ~100 minutes;
killing it mid-run wastes hours of bandwidth and DB work.

## 5. When in doubt, ask

If a task involves any of the above and the intent isn't obvious, stop and
ask the human. A five-second confirmation is cheaper than a broken
production database.
