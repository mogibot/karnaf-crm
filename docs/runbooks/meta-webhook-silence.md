# Runbook — Meta webhook (WhatsApp / IG / FB) stopped delivering

**Symptom:** no inbound messages for > 30 min during business hours,
or `/admin/health` shows last-inbound > expected SLA window. WhatsApp /
IG conversations on Mia's phone aren't reaching the CRM.

## Triage (≤ 5 min)

1. **Check it's actually quiet, not just code-broken:** open Supabase
   logs for `whatsapp-webhook` / `ig-webhook`. Are POSTs arriving at all?
   - If yes (POSTs arrive but fail to process): jump to "handler broken".
   - If no (no POSTs at all): jump to "Meta stopped delivering".
2. Confirm last delivery time:
   ```sql
   select max(received_at) from webhook_inbox
   where source in ('whatsapp', 'ig', 'fb-leadgen');
   ```

## Meta stopped delivering

1. Meta App Dashboard → your app → Webhooks. Each subscription card
   shows "Recent events" with green/red dots.
2. Common red flags:
   - **Verify token mismatch:** Meta retried verification, our endpoint
     returned 403. Confirm `WHATSAPP_VERIFY_TOKEN` (and `META_VERIFY_TOKEN`)
     env match what's saved in the Dashboard subscription.
   - **Cert expired:** `https://...functions.supabase.co/whatsapp-webhook`
     should always be valid (Supabase manages). Curl it externally —
     should return 401 (missing signature). If it errors at TLS layer,
     escalate to Supabase status.
   - **Subscription dropped:** Meta auto-disables webhooks that 500
     consistently. Re-enable in the Dashboard, then click "Test" to send
     a synthetic event.
3. If "Test" event arrives but real messages don't: the Meta App may be
   in development mode. Switch to Live, then re-verify.

## Handler broken

1. Look at `webhook_inbox` rows with `processed_status = 'server_error'`
   in the last hour. Each row carries the original body for replay.
2. Find the most recent `error_message` — usually points at the bug.
3. Patch + redeploy: `supabase functions deploy <name>`.
4. Replay the failed rows:
   ```bash
   curl -X POST https://...functions.supabase.co/webhook-replay \
     -H "Authorization: Bearer <admin-jwt>" \
     -H "Content-Type: application/json" \
     -d '{"filter":"failed_recent","limit":50}'
   ```

## After the incident

- If subscription dropped: set a Better-Uptime monitor on
  `/healthz?deep=1` so the next outage pages within 5 min, not 30.
- File a postmortem for any outage > 1 h.
