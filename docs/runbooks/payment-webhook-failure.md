# Runbook — payment-webhook 5xx / unmatched payments

**Symptom:** A customer paid but their lead never flipped to `won`, or
payment-webhook logs show repeated 500s, or Telegram alert fires with
`payment-webhook` source.

## Triage (≤ 5 min)

1. **Confirm money actually moved.** Check the payment provider's
   dashboard (PayPlus / GreenInvoice / Stripe) for the order/customer.
   Without confirmation, do NOT mark the lead `won`.
2. Pull recent payment_events rows:
   ```sql
   select id, lead_id, external_order_id, payment_status, payload_json
     from payment_events
    order by created_at desc
    limit 20;
   ```
3. Check function logs for the exact error.

## Common root causes

### Signature mismatch (Phase 0.4 fail-closed kicked in)

After we made webhooks fail-closed (Phase 0.4), missing `PAYMENT_WEBHOOK_SECRET`
returns 503. Confirm the secret is set:
```bash
supabase secrets list | grep PAYMENT_WEBHOOK_SECRET
```
If absent, set it and redeploy. Then ask provider to retry / replay
the failed event from THEIR dashboard.

### Unmatched lead

The handler tries to match `order_id → phone → email`. If none match
(e.g. customer paid with a new phone), the row goes into
`payment_events` with `lead_id IS NULL` and an `integration_logs` row
with `source = 'payment_webhook', status = 'unmatched'`.

Manual fix: find the lead by name, then:
```sql
update payment_events
   set lead_id = '<lead-id>'
 where id = '<event-id>';
-- If status indicates paid, also flip the lead:
update leads
   set lead_status = 'won', won_at = now(),
       payment_status = 'paid', payment_reference = '<order-id>'
 where id = '<lead-id>';
```

### Provider retried while we were down

The webhook handler is idempotent on `external_order_id`. Duplicate
events return 200 `{ duplicate: true }`. If you see double-counted
`payment_events`, the unique index on `external_order_id` is missing.
Check: `\d+ payment_events`.

### portal-provision didn't fire

After `won`, payment-webhook fires-and-forgets a call to `provision-student`
(gated by `PORTAL_PROVISION_ENABLED`). If the env flag is `false` or the
portal URL is wrong, the lead is `won` but never provisioned, and
`enqueue_won_without_provisioning_reviews` (Phase 3.7) will surface it
within 24h.

Manual provision:
```bash
curl -X POST https://...functions.supabase.co/provision-student \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -d '{"leadId":"<id>"}'
```

## Replay path

For genuinely-lost events (handler crashed before persisting), use
webhook-replay:
```bash
curl -X POST https://...functions.supabase.co/webhook-replay \
  -H "Authorization: Bearer <admin-jwt>" \
  -d '{"filter":"failed_recent","sourceOnly":"payment","limit":20}'
```

## After the incident

- File postmortem if > $X of revenue was at risk.
- Reach out to customer if their access was delayed > 1h.
