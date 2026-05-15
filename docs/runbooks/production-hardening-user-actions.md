# Production Hardening — User-Action Runbook

After PRs #6, #7, #8, and #9 land, these are the manual steps the
owner has to take. The slash command `/karnaf-deploy` (registered at
`~/.claude/commands/karnaf-deploy.md`) walks through this file
step-by-step.

## ⏳ 1. Rotate Supabase keys + delete leaked tmp files

**Why:** Two files at `~/.openclaw/workspace/tmp_supabase_{auth,login}_check.py`
contain hardcoded Supabase keys (open since 2026-05-03). Rotate first,
then delete.

1. Supabase Dashboard → Project `svkzkpgccahwmyflobvn` → Settings → API → Reset `service_role`.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel envs + Supabase Function secrets.
3. Reset `anon` key, update `VITE_SUPABASE_ANON_KEY` in Vercel.
4. Redeploy frontend + all functions.
5. Smoke: log in to https://karnaf-crm.vercel.app, open a lead.
6. Delete the tmp files.

## ⏳ 2. Protect master branch

```bash
gh api -X PUT repos/almog-hoc-org/karnaf-crm/branches/master/protection \
  -F required_status_checks='{"strict":true,"contexts":["lint-test","supabase-validate"]}' \
  -F required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  -F enforce_admins=false \
  -F restrictions=null \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

## ⏳ 3. Set required webhook secrets (PR-A makes fail-closed)

Before merging PR-A (#6), confirm:

```bash
supabase secrets list --project-ref svkzkpgccahwmyflobvn
```

Must include:
- `INTAKE_WEBHOOK_SECRET`
- `PAYMENT_WEBHOOK_SECRET`
- `EMAIL_WEBHOOK_SECRET`
- `WHATSAPP_APP_SECRET`
- `SLA_WORKER_SECRET`

Each missing one → that webhook returns 503 after PR-A merges.

## ⏳ 4. Apply migrations 027-032

```bash
cd "C:\Users\mogi\vs code\karnaf crm\karnaf-crm"
supabase db push --project-ref svkzkpgccahwmyflobvn
```

After PR-B + PR-D both merged:

| Migration | What it adds | Phase |
|---|---|---|
| 027_job_runs | Idempotent cron ledger | PR-B |
| 028_work_queue_idempotency | Partial unique index + dormant scan index | PR-B |
| 029_realtime_publication | messages/leads/work_queue/conversation_claims live | PR-B |
| 030_lifecycle_rpcs | dormant_reactivation + handoff_TTL + won_stalled RPCs | PR-D |
| 031_ownership_consistency_trigger | conv vs lead ownership divergence logger | PR-D |
| 032_webhook_inbox | Payload persistence + replay helper | PR-D |

Verify after apply:

```sql
-- Confirm publication has the live tables (was empty before PR-B)
select schemaname, tablename from pg_publication_tables
 where pubname='supabase_realtime' order by tablename;
-- Expect: conversation_claims, leads, messages, work_queue

-- Confirm partial unique index exists
\d+ work_queue
-- Expect: work_queue_pending_dedupe UNIQUE, partial WHERE (status='pending')
```

## ⏳ 5. Deploy edge functions

After PR-A + PR-B + PR-C + PR-D all merge:

```bash
# Updated
supabase functions deploy email-webhook leads-intake payment-webhook \
  provider-status-webhook whatsapp-webhook nightly-jobs sla-worker \
  admin-actions lead-detail --project-ref svkzkpgccahwmyflobvn

# New
supabase functions deploy healthz webhook-replay pii-export pii-delete \
  --project-ref svkzkpgccahwmyflobvn
```

## ⏳ 6. Production smoke checklist

- [ ] `curl https://karnaf-crm.vercel.app/api/healthz?deep=1` returns 200 + JSON
- [ ] `curl https://svkzkpgccahwmyflobvn.functions.supabase.co/healthz?deep=1` returns 200 with `db.ok`, `ai.configured`, `cron.detail`
- [ ] Open a test lead in CRM, send WhatsApp inbound from another phone → message appears within 2s (fixes "Mia missing live messages")
- [ ] On test lead in mia_active mode, click "החזרה ל-AI" → check `integration_logs` for `orchestrate-message` invocation within seconds (fixes "AI returns silent after handoff")
- [ ] Lead header shows clear `CurrentOwnerLine` with operator's full name when mia_active
- [ ] Forced bad signature on any webhook → 401; missing secret env (test) → 503
- [ ] `nightly-jobs` invoked twice same day → second response reports `skipped: already_ran_today`
- [ ] `POST /functions/v1/webhook-replay {"filter":"failed_recent","limit":3}` returns results array
- [ ] `POST /functions/v1/pii-export {"leadId":"<test>"}` returns 8 tables

## 🟡 7. Activate optional features

| Feature | Env vars | Effect |
|---|---|---|
| Telegram alerts | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` | sla-worker pushes SLA breach digests |
| Uptime monitor | external (BetterUptime) | Probes `/api/healthz?deep=1` every 1 min |

## External Meta/Google blockers (carried over)

- WhatsApp template `karnaf_followup_v1` Meta approval
- IG webhook subscription + `FACEBOOK_PAGE_ACCESS_TOKEN`
- FB Lead Ads webhook
- Form snippet on karnafnadlan.com
- ManyChat External Request setup
- GAS inbound script

## Pilot rollout (after smoke green)

Follow `docs/pilot/scenarios.md` (TBD if not yet written) — 5 personas × 60 min each.
