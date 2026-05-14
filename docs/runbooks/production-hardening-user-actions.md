# Production Hardening — User-Action Runbook

This runbook lists every action the Karnaf CRM owner has to take **manually**
to complete the production hardening pass landed on branch
`production-hardening`. None of these can be done headlessly from a Claude
Code session — they need a dashboard login or an interactive secret entry.

Status legend:
- ⏳ **Required for go-live** — production is fragile until done.
- 🟡 **Required to enable a feature scaffolded in code** — code is ready,
  flipping the env vars activates it silently.
- 🟢 **Optional polish** — improves posture but not urgent.

Carry these forward as GitHub issues with the `production-hardening`
label once the branch lands.

---

## ⏳ 1. Rotate Supabase keys + delete leaked tmp files

**Why:** Two files in `~/.openclaw/workspace/tmp_supabase_{auth,login}_check.py`
contain hardcoded Supabase keys, open since 2026-05-03. They must be
rotated **before** deletion in case they ever leaked to git history of any
sibling repo.

**Steps:**

1. Open Supabase Dashboard → Project `svkzkpgccahwmyflobvn` → Settings → API.
2. Click **Reset** on `service_role` key. Copy the new key.
3. Update wherever the old key was stored:
   - Vercel → Project `karnaf-crm` → Settings → Environment Variables →
     update `SUPABASE_SERVICE_ROLE_KEY` (production + preview).
   - Supabase Edge Function secrets:
     ```bash
     supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<new-key> --project-ref svkzkpgccahwmyflobvn
     ```
4. Click **Reset** on the `anon` key. Copy the new key.
5. Update `VITE_SUPABASE_ANON_KEY` in Vercel.
6. Redeploy: `vercel deploy --prod` (frontend) and
   `supabase functions deploy --project-ref svkzkpgccahwmyflobvn` (every function).
7. Smoke check: open https://karnaf-crm.vercel.app, log in, view dashboard.
8. **Only after smoke is green**, delete the two tmp files:
   ```powershell
   Remove-Item "$env:USERPROFILE\.openclaw\workspace\tmp_supabase_auth_check.py"
   Remove-Item "$env:USERPROFILE\.openclaw\workspace\tmp_supabase_login_check.py"
   ```
9. Grep the workspace for residual key fragments:
   ```bash
   grep -r "eyJhbGciOi" "$HOME/.openclaw/workspace" "$HOME/.claude/projects" 2>/dev/null
   ```

---

## ⏳ 2. Protect master branch on GitHub

**Why:** With `master` unprotected, anyone with push access can ship
production bypass-everything. Branch protection is the first line of
defence against accidental destructive changes.

**Command** (run once, requires `gh` CLI authenticated):

```bash
gh api -X PUT repos/mogibot/karnaf-crm/branches/master/protection \
  -H 'Accept: application/vnd.github+json' \
  -F required_status_checks='{"strict":true,"contexts":["lint-test","supabase-validate"]}' \
  -F enforce_admins=false \
  -F required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  -F restrictions=null \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

Verify in GitHub UI → Settings → Branches that `master` shows the lock
icon and required checks.

---

## ⏳ 3. Set required webhook secrets

**Why:** Phase 0.4 made all webhooks **fail-closed**. Without these secrets
set, every inbound webhook returns 503 and lead intake stops. This is
correct behaviour, but the secrets must exist for production.

**Required Edge Function secrets** (set via `supabase secrets set ...`
or Dashboard → Edge Functions → Secrets):

| Variable | Used by | Source |
|---|---|---|
| `INTAKE_WEBHOOK_SECRET` | `leads-intake` | generate `openssl rand -hex 32`, also set on every relay (e.g. `INTAKE_WEBHOOK_SECRET` Vercel env on `api/intake-relay.ts`) |
| `EMAIL_WEBHOOK_SECRET` | `email-webhook` | from your inbound-email provider (Mailgun / Postmark / SendGrid) — used as HMAC key |
| `PAYMENT_WEBHOOK_SECRET` | `payment-webhook` | from payment provider (PayPlus / GreenInvoice / Bit / Stripe) |
| `WHATSAPP_APP_SECRET` | `whatsapp-webhook`, `provider-status-webhook` | Meta App → Settings → Basic → App Secret |
| `META_APP_SECRET` | `ig-webhook`, `fb-leadgen-webhook` (falls back to `WHATSAPP_APP_SECRET`) | usually same as above |

To temporarily bypass for local dev, set `WEBHOOK_ALLOW_UNSIGNED=true` on
the dev project's Edge Function env. **Do not set this in production.**

---

## ⏳ 4. Apply migrations 027 + 028

**Why:** Phase 1 ships two new migrations:
- `027_job_runs.sql` — idempotency ledger for nightly cron.
- `028_work_queue_idempotency.sql` — partial unique index preventing
  duplicate pending queue items + dormant-scan index on `leads`.

**Apply:**

```bash
cd "C:\Users\mogi\vs code\karnaf crm\karnaf-crm"
supabase db push --project-ref svkzkpgccahwmyflobvn
```

Verify:
```bash
supabase migration list --project-ref svkzkpgccahwmyflobvn
# Both 027 and 028 should appear in Local AND Remote columns.
```

After apply, confirm the dedupe index works:
```sql
-- In Supabase SQL editor
\d+ work_queue
-- Look for "work_queue_pending_dedupe" UNIQUE, partial WHERE (status = 'pending'::text)
\d+ leads
-- Look for "ix_leads_status_updated_at" btree (lead_status, updated_at)
```

---

## ⏳ 5. Deploy the new + modified Edge Functions

**Why:** Phase 0 + 1 modified or added these functions:

Modified:
- `nightly-jobs` — guarded by `claim_job_run`
- `sla-worker` — explicit error propagation
- `email-webhook`, `payment-webhook`, `provider-status-webhook`,
  `leads-intake`, `whatsapp-webhook`, `fb-leadgen-webhook`, `ig-webhook` —
  fail-closed auth
- `_shared/ai-provider.ts` — 20s AbortController + Gemini header key
- `_shared/ai-prompt.ts` — prompt-injection sanitizer

New:
- `healthz` — liveness + deep checks
- `_shared/notify-telegram.ts` — shared alerting helper
- `_shared/observability.ts` — Sentry shim scaffold

**Deploy:**

```bash
# Single function:
supabase functions deploy <name> --project-ref svkzkpgccahwmyflobvn

# All functions in one go:
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [[ "$name" == "_shared" ]] && continue
  echo "Deploying $name"
  supabase functions deploy "$name" --project-ref svkzkpgccahwmyflobvn || break
done
```

Smoke check `/healthz`:
```bash
curl -i "https://svkzkpgccahwmyflobvn.functions.supabase.co/healthz"
curl -i "https://svkzkpgccahwmyflobvn.functions.supabase.co/healthz?deep=1"
# Both should return JSON; deep should include checked.db.ok=true.
```

---

## 🟡 6. Activate Sentry (`@sentry/react` real upgrade)

**Why:** Phase 1.6 landed a Sentry-compatible **shim** at
`apps/web/src/lib/observability.ts` + `supabase/functions/_shared/observability.ts`.
Without a DSN it's a no-op. With a DSN, the shim sends events directly via
`fetch`/`sendBeacon`. For full SDK features (transactions, breadcrumbs UI,
sourcemap upload), upgrade to the real `@sentry/react`.

**Steps:**

1. Create a Sentry project at https://sentry.io → Project Type "React".
2. Copy the DSN. Set as `VITE_SENTRY_DSN` in Vercel + `SENTRY_DSN` in
   Supabase Edge Function secrets.
3. (Optional) Full SDK install:
   ```bash
   npm install @sentry/react sentry-vite-plugin
   ```
   Then in `apps/web/src/main.tsx` add `Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, … })`.
4. (Optional) Wire sourcemap upload via `sentry-vite-plugin` in `vite.config.ts`.
5. To verify: throw deliberately in `/healthz` UI; an issue should appear
   in Sentry within a minute, with the breadcrumbs we collect (route changes,
   API call categories).

---

## 🟡 7. Activate Telegram alerts

**Why:** Phase 1.8 created `_shared/notify-telegram.ts` and rewired
`sla-worker` to use it. Without env vars, alerts are silently dropped.

**Steps:**

1. Create a Telegram bot via @BotFather. Copy the bot token.
2. Send `/start` to the bot from your Telegram account so it can DM you.
3. Find your chat ID by visiting
   `https://api.telegram.org/bot<token>/getUpdates` after sending a message.
4. Set Supabase Edge Function secrets:
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=<token>
   supabase secrets set TELEGRAM_ALERT_CHAT_ID=<chat-id>
   # Optional, for forum/topic groups:
   supabase secrets set TELEGRAM_ALERT_THREAD_ID=<thread-id>
   ```
5. Trigger an SLA breach (or wait for the next 10-min sla-worker tick that
   has breaches). You should receive a digest.

---

## 🟢 8. Set up uptime monitor for `/healthz`

**Why:** `/healthz` and `/api/healthz` are public, no-auth endpoints
designed for external probing. Pair them with an uptime monitor so
production-down is observable within minutes.

**Suggested free options:**
- **BetterUptime** (https://betteruptime.com) — 10 monitors, alerts to
  Telegram/Slack/email.
- **Vercel Monitoring** (https://vercel.com/docs/observability/monitoring) —
  built into the Vercel project.

**Probe URLs:**
- Liveness: `GET https://karnaf-crm.vercel.app/api/healthz`
- Backend liveness: `GET https://svkzkpgccahwmyflobvn.functions.supabase.co/healthz`
- Deep check (1 / 5 min recommended): same URL + `?deep=1`

---

## ⏳ 9. Open the production-hardening PR (branch handling)

The work landed on branch `production-hardening`. The branch carries
~30 pre-existing uncommitted files from earlier sessions *plus* this
session's hardening commits. When opening the PR, you may want to:

- **Option A (recommended): split into two PRs.**
  1. First PR: "sync: deployed work to master" — the 30 pre-existing
     modified/untracked files. Merge first so subsequent diffs are clean.
  2. Second PR: "production hardening (Phase 0 + 1)" — only the
     session-touched files (listed in the next section).

- **Option B: single mega-PR.** Faster but the diff is huge and reviewers
  cannot triangulate which change is which.

### Files touched by this session

| Layer | Files |
|---|---|
| **Backend / Edge** | `supabase/functions/_shared/ai-provider.ts`, `supabase/functions/_shared/ai-prompt.ts`, `supabase/functions/_shared/notify-telegram.ts` (new), `supabase/functions/_shared/observability.ts` (new), `supabase/functions/nightly-jobs/index.ts`, `supabase/functions/sla-worker/index.ts`, `supabase/functions/email-webhook/index.ts`, `supabase/functions/payment-webhook/index.ts`, `supabase/functions/provider-status-webhook/index.ts`, `supabase/functions/leads-intake/index.ts`, `supabase/functions/whatsapp-webhook/index.ts`, `supabase/functions/fb-leadgen-webhook/index.ts`, `supabase/functions/ig-webhook/index.ts`, `supabase/functions/healthz/index.ts` (new) |
| **Migrations** | `supabase/migrations/027_job_runs.sql` (new), `supabase/migrations/028_work_queue_idempotency.sql` (new) |
| **Frontend** | `apps/web/src/lib/observability.ts`, `apps/web/src/pages/UsersPage.test.tsx`, `apps/web/src/pages/PromptVariantsPage.test.tsx` |
| **Edge web (Vercel)** | `api/healthz.ts` (new) |
| **CI / config** | `.github/workflows/ci.yml` |
| **Docs** | `docs/runbooks/production-hardening-user-actions.md` (this file) |

---

## ⏳ 10. Verify after deploy (smoke checklist)

After all of the above lands in production, run through this list to
confirm everything is green:

- [ ] `curl https://karnaf-crm.vercel.app/api/healthz` returns 200 + JSON.
- [ ] `curl 'https://svkzkpgccahwmyflobvn.functions.supabase.co/healthz?deep=1'` returns 200 + `checked.db.ok=true`.
- [ ] Inbound test lead via `/api/intake-relay` (sign with `INTAKE_WEBHOOK_SECRET`) lands in `leads`.
- [ ] Forced bad signature on any webhook returns 401.
- [ ] Missing secret on any webhook returns 503 (after temporarily unsetting and redeploying that single function in a non-prod env — do **not** unset in production).
- [ ] Manually invoke `nightly-jobs` twice in the same day; second response includes `summary.<kind>.skipped='already_ran_today'`.
- [ ] Manually invoke `sla-worker`; response includes `queryErrors: []`. Force a DB error by passing a bad bearer; response is 401.
- [ ] In `/admin/health`, the last `job_runs` row reflects today's date.
- [ ] Log in as `mia@karnaf.io` (or impersonate). Open `/admin/users` and `/admin/prompts`. Both load (no redirect-loop) and show their data.
- [ ] Set a Sentry DSN (optional, item 6) and confirm an issue arrives.
- [ ] Telegram bot configured (item 7) — wait for the next SLA tick or force one.

---

## Phase 2 / 3 / 4 — user actions

Phase 2 + 3 + 4 all landed code-side on this branch. Below are the
**post-deploy user actions** they require.

### Migrations to apply (in order)

```bash
supabase db push --project-ref svkzkpgccahwmyflobvn
# Confirms 029-034 all applied:
supabase migration list --project-ref svkzkpgccahwmyflobvn
```

| Migration | What it adds | Phase |
|---|---|---|
| 029_prompt_variant_change_requests | Manager → admin change-request flow table | P2.2 |
| 031_saved_filters | lead_saved_filters table with RLS | P3.4 |
| 032_dormant_reactivation | 3 RPCs (dormant / handoff TTL / won-onboarding-stalled) | P3.7 |
| 033_ownership_consistency_trigger | Trigger logging conv vs lead ownership divergence | P3.7 |
| 034_webhook_inbox | Raw payload persistence + purge_webhook_inbox RPC | P4.2 |

### Functions to deploy (after migrations)

```bash
# Updated:
supabase functions deploy prompt-variants leads-manage leads-list \
  admin-actions sla-worker nightly-jobs send-reply leads-intake \
  --project-ref svkzkpgccahwmyflobvn

# New:
supabase functions deploy webhook-replay pii-export pii-delete \
  --project-ref svkzkpgccahwmyflobvn
```

### Production smoke checks (Phase 2-4)

- [ ] Log in as Mia (mia tier). Open `/admin/prompts` — see read-only
      stats + change-request form. No redirect.
- [ ] Mark a test lead `won`. Toast shows "בטל" button — clicking it
      reverts within 10s (verifies P2.3 undo + P2.4 optimistic).
- [ ] Open the same lead in two browsers. Both see the other's avatar
      in the header (P2.5 presence).
- [ ] In `/leads`, select 5 rows, hit "ייצוא CSV". Open in Excel; Hebrew
      renders correctly (P3.2).
- [ ] Click a source name in `/analytics` → lands at `/leads?source=...`
      with the source filter active and date range pre-applied (P3.1).
- [ ] Hit `?` from any page — keyboard shortcuts cheatsheet pops (P3.5).
- [ ] Press `J` then `K` on `/leads` — focus moves to next/prev row.
- [ ] Wait for the next sla-worker tick. Verify `dormant_reactivation`
      or `won_onboarding_stalled` queue items appear if you have leads
      matching (P3.7).

### Production smoke — Phase 4 reliability

- [ ] `curl https://...functions.supabase.co/healthz?deep=1` returns
      `ok:true` with `db.ok`, `ai.configured`, and `cron.detail`
      reflecting a recent nightly run.
- [ ] Run the **backup restore drill** (`docs/runbooks/backup-restore.md`)
      against a scratch project. Note the RTO in the history table.
- [ ] After the next webhook server_error in production, hit
      `/functions/v1/webhook-replay` with `{"inboxId": "<id>"}` and
      verify the replay creates a fresh `webhook_inbox` row marked
      `success`.
- [ ] PII export: pick a test lead, POST to `pii-export` with
      `{"leadId":"..."}`, confirm the JSON bundle has 10 tables.
- [ ] Trigger a manual k6 run via `gh workflow run load.yml --field
      scenario=intake-flood`. Threshold (`p95<800ms`) should pass on
      staging.

### Items still requiring external dashboards (carried forward)

These are the same items called out in Phase 0/1 above — none of them
are completable from a Claude Code session:

- [ ] Supabase service-role + anon key rotation + tmp file deletion.
- [ ] GitHub master branch protection via `gh api`.
- [ ] All webhook secrets set (`INTAKE_WEBHOOK_SECRET`,
      `PAYMENT_WEBHOOK_SECRET`, `EMAIL_WEBHOOK_SECRET`,
      `WHATSAPP_APP_SECRET`, `META_APP_SECRET`).
- [ ] Sentry DSN (`VITE_SENTRY_DSN` + `SENTRY_DSN`) — the shim auto-
      ingests once set; full @sentry/react SDK upgrade is optional.
- [ ] Telegram alerts (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID`).
- [ ] Uptime monitor pointed at the new `/healthz` endpoints.
- [ ] Meta App: WhatsApp template `karnaf_followup_v1`, IG webhook
      subscription, FB Lead Ads webhook, `FACEBOOK_PAGE_ACCESS_TOKEN`.
- [ ] Form snippet on karnafnadlan.com, ManyChat External Request, GAS
      inbound script in Google Sheets.

### Pilot rollout (after the smoke checks pass)

Follow `docs/pilot/scenarios.md`. Five personas, 60min each, in this
order: Mia → sales_rep on phone → admin → inbound lead → multi-operator.
Triage findings as P1/P2/P3; ship P1 fixes before pilot day 2.
