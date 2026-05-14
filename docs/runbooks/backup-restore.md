# Backup & restore drill

**Audience:** Karnaf CRM owner / on-call admin.
**Cadence:** Quarterly. Last drill: _never_ — schedule the first.

## What's protected

Supabase Pro plan includes **point-in-time recovery (PITR)** with 7-day
retention. Daily logical backups are also kept for 30 days. The CRM
relies on both — PITR for "rollback to 5 minutes before that bad
migration" and logical for "restore an entire database to a scratch
project to audit a leaked event."

- **In scope:** All `public.*` tables. RLS policies. Functions/triggers.
- **Out of scope (handled separately):** Vercel build artifacts (replay
  any tagged commit), Edge Function code (deployed from this repo's
  `supabase/functions/` — `supabase functions deploy <name>` recreates
  them), Vercel + Supabase environment secrets (rotate via runbook §1
  of `production-hardening-user-actions.md`).

## RTO / RPO targets

| Scenario                                | RPO (data loss) | RTO (time to working) |
|-----------------------------------------|-----------------|-----------------------|
| Accidental row delete                   | ≤ 1 min         | ≤ 30 min              |
| Bad migration applied to prod           | ≤ 5 min         | ≤ 1 h                 |
| Region-wide Supabase outage             | best-effort     | 4 h to scratch project |
| Total project loss                      | ≤ 24 h          | 24 h to fresh project |

## Quarterly drill — what to actually do

1. **Create a scratch project.** Supabase Dashboard → New Project →
   `karnaf-crm-restore-drill-<yyyymmdd>` in the same region. Pick the
   smallest tier; this lives ≤ 1h.
2. **PITR clone:** Project Settings → Database → Restore → choose a
   recovery point ≈ 24 hours ago → target the scratch project. Wait for
   restore (typically 5-15 min).
3. **Verify schema parity:** From this repo:
   ```bash
   supabase db diff \
     --linked-source <prod-ref> \
     --linked-target <scratch-ref>
   ```
   Expect an empty diff (or migrations newer than the recovery point —
   those will be the ones added in the last 24h).
4. **Smoke read:** Run `scripts/restore-smoke.sh` (below) against the
   scratch project to confirm a representative read works:
   ```bash
   supabase/scripts/restore-from-pitr.sh smoke <scratch-ref>
   ```
5. **Tear down:** Delete the scratch project. Note the wall-clock RTO
   for this drill in this file's history section.

## When you're actually restoring (not a drill)

1. **Decide PITR or logical.** PITR is faster but limited to 7d. If the
   incident is older, use a logical backup downloaded from Dashboard.
2. **Take the app down first.** Set Vercel project to maintenance mode
   so writes don't race the restore. (Use the existing kill-switch:
   set `MAINTENANCE_MODE=true` in Vercel envs and redeploy.)
3. **Restore into a NEW project**, never overwrite prod. Then either
   point the app at the new project, or replay the new project's
   tables back into prod via pg_dump → pg_restore.
4. **After restore:** Re-issue every webhook secret (assume rotation).
   Verify cron jobs are scheduled in the new project (`select * from
   cron.job;` — Supabase pg_cron). Redeploy Edge Functions:
   `supabase functions deploy --project-ref <new-ref>`.
5. **Postmortem:** within 7 days, write up what happened + what we'd do
   differently. File in `docs/postmortems/`.

## Common failure modes

- **PITR window expired:** Logical backup only. Older than 30d = data
  loss accepted as Supabase contract.
- **Schema migration newer than restore point:** Reapply migrations
  manually in the scratch project before the smoke step.
- **RLS policy depends on auth.users that aren't restored:** Supabase
  separately backs up `auth.*`; verify both schemas restored.

## Drill history

| Date       | RTO observed | Notes |
|------------|--------------|-------|
| _pending_  | —            | First drill — schedule via calendar invite. |
