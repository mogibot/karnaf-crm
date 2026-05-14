# Runbook — Secret rotation

**When to run:** quarterly (schedule it), AND immediately if any secret
is suspected leaked (committed to git, mentioned in a Slack channel,
typed into a third-party tool, etc.).

## Inventory — what we have

| Secret                          | Where stored                       | Rotation source                 |
|---------------------------------|------------------------------------|----------------------------------|
| `SUPABASE_SERVICE_ROLE_KEY`     | Vercel env + Supabase function env | Supabase Dashboard → API → Reset |
| `SUPABASE_ANON_KEY`             | Vercel env (`VITE_SUPABASE_ANON_KEY`) | Same                          |
| `INTAKE_WEBHOOK_SECRET`         | Vercel relay + Supabase function   | Generate via `openssl rand -hex 32` |
| `PAYMENT_WEBHOOK_SECRET`        | Supabase function env              | Payment provider dashboard       |
| `EMAIL_WEBHOOK_SECRET`          | Supabase function env              | Email provider dashboard         |
| `WHATSAPP_APP_SECRET`           | Supabase function env              | Meta App Dashboard → Basic       |
| `META_APP_SECRET`               | Same as WHATSAPP_APP_SECRET usually | Same                            |
| `WHATSAPP_TOKEN` (access)       | Supabase function env              | Meta App → System Users token    |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` | Supabase function env | Each provider's console |
| `TELEGRAM_BOT_TOKEN`            | Supabase function env              | @BotFather → /revoke + reissue   |
| `SENTRY_DSN` / `VITE_SENTRY_DSN`| Vercel + Supabase function env     | Sentry project settings          |

## Procedure (one secret at a time)

1. **Generate the new value** in the rotation source above.
2. **Set it in BOTH places** the secret lives:
   - Vercel: `vercel env add <NAME> production` (or the Dashboard UI).
   - Supabase: `supabase secrets set <NAME>=<value> --project-ref svkzkpgccahwmyflobvn`.
3. **Redeploy** the consumer:
   - Frontend (Vercel) auto-redeploys on env change (5-min lag).
   - Edge Functions: `supabase functions deploy <name>` or all-functions
     loop from the production-hardening runbook §5.
4. **Verify** with a smoke call:
   - HMAC-signed webhooks: curl with the new secret → 200.
   - AI: trigger a real orchestrate-message run via the orchestrator.
   - Auth: `/admin/health?deep=1` shows `ai.ok=true`.
5. **Revoke the old value** at the rotation source.

## Special cases

### Service-role key

This one is load-bearing for every Edge Function. Plan a short
maintenance window (Vercel + Supabase env propagation can take 2-3 min).
Set `MAINTENANCE_MODE=true` in Vercel envs first, redeploy, do the
rotation, redeploy with `MAINTENANCE_MODE=false`. Total downtime ~5min.

### Meta App Secret

After rotation, EVERY active Meta webhook subscription (WhatsApp, IG,
FB Lead Ads) needs to be re-validated. Meta Dashboard → Webhooks tab →
click "Test" on each subscription card. Failed tests → re-add the URL.

### Telegram bot token

`/revoke` from @BotFather replaces the token. The old one stops working
immediately. Update env, redeploy, then send a test alert.

## After rotation

- Update `docs/runbooks/secret-rotation.md` (this file) with the
  rotation date in a footer log.
- If the rotation was from a suspected leak, also:
  - Audit access logs in each consumer for unusual activity.
  - File a postmortem with timeline + cause + control gap.

## Log

| Date | What rotated | Reason | Operator |
|------|--------------|--------|----------|
| _pending first rotation_ | — | — | — |
