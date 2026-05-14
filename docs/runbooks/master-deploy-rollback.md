# Runbook — Roll back a bad master deploy

**Symptom:** A deploy to master made it to production (Vercel auto-deploys
master, Edge Functions only via manual `supabase functions deploy`),
and something is now broken in prod. Quick revert needed.

## Triage (≤ 2 min)

1. **Identify what broke.** Vercel dashboard → Deployments tab.
   Most recent deploy will be at top. Click → Function Logs / Build Logs.
2. **Identify which deploy was the last known good.** Vercel
   "Promote to Production" button is non-destructive; you can re-promote
   any old build.

## Roll back

### Vercel frontend

1. Vercel Dashboard → Deployments.
2. Find the last green deploy before the regression.
3. Click "Promote to Production." Confirms in ~10s.
4. Verify https://karnaf-crm.vercel.app loads + a smoke endpoint works:
   `curl https://karnaf-crm.vercel.app/api/healthz` → 200.

### Supabase Edge Functions

There's no Supabase-native rollback. Re-deploy from the prior git tag:
```bash
git fetch --tags
git checkout v<previous-tag>
supabase functions deploy <name> --project-ref svkzkpgccahwmyflobvn
git checkout master
```
If you don't tag releases (you should — see below), use the last good
commit SHA:
```bash
git checkout <sha>
supabase functions deploy <name>
```

### Migrations

**Don't roll back migrations.** Once applied to prod they're load-bearing
state. Instead, write a forward-compensating migration (e.g.
`044_revert_field_x.sql`) that undoes the bad change.

## Damage-control checklist

- [ ] Frontend reverted, smoke green.
- [ ] Edge Functions reverted (if needed).
- [ ] No migration applied since the bad deploy? If yes, write
      compensating migration.
- [ ] Telegram-announce to ops team: "rolled back deploy X — root cause
      pending."
- [ ] Open a postmortem doc in `docs/postmortems/<date>-<incident>.md`.

## Preventing the next one

- **Tag releases.** Adopt a `release-YYYYMMDD-HHMM` tag per prod deploy
  so rollback is one `git checkout` away.
- **Master branch protection** (per production-hardening runbook §2)
  blocks force-push and requires CI + 1 review.
- **Smoke tests** in the Vercel preview should be running before merge —
  consider promoting them to a CI gate.
