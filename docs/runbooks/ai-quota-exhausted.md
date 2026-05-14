# Runbook — AI provider quota exhausted

**Symptom:** orchestrate-message logs report `circuit_open` repeatedly;
new leads come in but no AI reply ships. Telegram alert fires with
`source: sla-worker` and ai_confused counter ≥ 0.

## Triage (≤ 5 min)

1. `supabase functions logs orchestrate-message | head -20` — confirm
   it's the AI breaker, not a DB outage. Look for
   `ai_provider_failover` events (means the fallback chain is engaged).
2. Check which provider is failing: the breaker key in logs is `ai:<name>`.
3. Look at the provider's status page:
   - OpenAI: https://status.openai.com
   - Gemini: https://status.cloud.google.com
   - Groq: https://groqstatus.com

## Mitigation (≤ 15 min)

### If it's a quota hit (most common)

Path A — let the fallback chain handle it:
- The circuit breaker auto-cools in 5 minutes (see `circuit-breaker.ts`).
- During those 5 min, the orchestrator uses the next configured provider
  (Phase 4.3 failover). No action needed if Gemini/Groq are also
  configured AND have quota. **Verify** via `ai_provider_failover` logs.

Path B — force a provider swap immediately:
- `supabase secrets set AI_PROVIDER=groq` (or `gemini` / `openai`).
- Redeploy the function: `supabase functions deploy orchestrate-message`.
- The breaker resets on the next call.

### If all providers are down

- Set `crm_config.ai_enabled_channels` to `[]` so the orchestrator
  queues `human_handoff` for every inbound instead of trying AI.
- Telegram-alert the team — Mia takes the wheel.

## After the incident

- Bump the failed provider's quota / billing.
- Reset `AI_PROVIDER=` to empty (auto-pick).
- Restore `ai_enabled_channels` to `['whatsapp']` (or your prod default).
- File a postmortem if the outage was > 30 min.
