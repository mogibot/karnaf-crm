# Runbook — Duplicate leads showing up

**Symptom:** A lead appears in `/leads` with the same phone or email as
an existing lead. Operator sees two cards for what should be one person.

## Triage (≤ 5 min)

1. Confirm it's actually a duplicate, not a misread:
   ```sql
   select id, full_name, phone, email, source, created_at
     from leads
    where phone = '+972<digits>' or email = '<addr>'
    order by created_at;
   ```
2. Note both IDs and timestamps.

## Common root causes

### Phone normalised differently

The intake handler runs `normalizeIsraeliPhone()` (see `_shared/phone.ts`).
If two intakes carried `050-1234567` and `+972501234567`, both should
normalise to `+972501234567`. If they didn't, the normaliser hit an
edge case.

Fix: merge in DB, then file a bug in `phone.ts` with the failing input.
```sql
-- Merge B into A. Re-point conversations, messages, queue items.
update conversations set lead_id = '<A>' where lead_id = '<B>';
update messages       set lead_id = '<A>' where lead_id = '<B>';
update lead_events    set lead_id = '<A>' where lead_id = '<B>';
update work_queue     set lead_id = '<A>' where lead_id = '<B>';
update lead_tasks     set lead_id = '<A>' where lead_id = '<B>';
-- Then mark B duplicate (don't delete; we keep history).
update leads set duplicate = true, do_not_contact = true,
                lead_status = 'lost', lost_reason = 'merged_into:<A>'
 where id = '<B>';
```

### Different intake channels (e.g. WhatsApp + Form)

If a lead submitted the landing-page form AND messaged WhatsApp, the
intake pipeline might dedupe by phone but the form had no phone (only
email), and the WhatsApp had no email. Two leads, both half-populated.
Same merge SQL as above. Long-term: enrich dedup to use email too.

### Race condition

Two webhooks arriving at exactly the same millisecond can both insert.
Migration 003 has the unique index, but if it was added AFTER the
duplicates, they slipped through. Verify:
```sql
select indexname from pg_indexes where tablename = 'leads';
-- Should include something like leads_phone_unique.
```

## After the incident

- If it was the normaliser: add the failing case to `phone.test.ts`.
- If it was a missing unique index: file a P1 migration to add it.
- Tell Mia not to delete duplicates manually; always merge so the
  history survives.
