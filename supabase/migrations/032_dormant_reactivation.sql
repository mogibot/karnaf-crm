-- Karnaf CRM Core - Dormant re-activation + handoff TTL + onboarding-stalled escalation.
--
-- The audit flagged three lifecycle dead-ends:
--   1. Dormant leads (sla-worker moves them there after `nurtureHours * 7`
--      idle) have no re-activation path. Operators have to find them by hand.
--   2. human_handoff queue items have no TTL — if Mia is on vacation
--      the item stays pending indefinitely.
--   3. `won` leads with no provisioning event after some grace period
--      indicate a stalled onboarding handoff that no-one is watching.
--
-- This migration adds the SQL surface for all three. The sla-worker
-- function picks up the new behaviour via additional queue items in the
-- next tick — no function change required for #1 and #2 (the cron job
-- runs the same query, just with extra rows).

-- ── 1. Mark a dormant lead for re-activation review ──────────────────────
-- Idempotent: if a dormant_reactivation_review queue item already exists,
-- the unique partial index from migration 028 keeps this from duplicating.
create or replace function enqueue_dormant_reactivation_reviews(
  p_max_age_days int default 60
) returns int
language plpgsql
as $$
declare
  v_inserted int := 0;
begin
  with candidates as (
    select id
      from leads
     where lead_status = 'dormant'
       and do_not_contact = false
       and removed_by_request = false
       and updated_at < now() - make_interval(days => p_max_age_days)
       and not exists (
         select 1 from work_queue
          where work_queue.lead_id = leads.id
            and queue_type = 'dormant_reactivation_review'
            and status = 'pending'
       )
     limit 100
  )
  insert into work_queue (lead_id, queue_type, status, priority_level, queue_summary, reason, payload_json, created_by_actor_type)
  select id, 'dormant_reactivation_review', 'pending', 3,
         'Dormant ' || p_max_age_days || '+ days — review for re-activation or close',
         'Auto-enqueued by enqueue_dormant_reactivation_reviews',
         jsonb_build_object('source', 'cron', 'max_age_days', p_max_age_days),
         'system'
    from candidates;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- ── 2. human_handoff TTL — escalate stale pending items ──────────────────
-- Bumps priority from 2 → 1 and notifies. Idempotent via the partial
-- unique index — we update existing rows in place rather than inserting.
create or replace function escalate_stale_handoffs(
  p_stale_after_hours int default 24
) returns int
language plpgsql
as $$
declare
  v_updated int := 0;
begin
  update work_queue
     set priority_level = 1,
         payload_json = coalesce(payload_json, '{}'::jsonb)
                        || jsonb_build_object('escalated_at', now(), 'stale_after_hours', p_stale_after_hours)
   where queue_type = 'human_handoff'
     and status = 'pending'
     and priority_level > 1
     and created_at < now() - make_interval(hours => p_stale_after_hours);
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- ── 3. Won-but-not-onboarded escalation ───────────────────────────────────
-- Leads that crossed to status=won but never got a portal_invite_code
-- after `p_grace_hours` indicate a stalled handoff (provision-student
-- silently failed, payment-webhook didn't fire, or the portal bridge is
-- mis-configured). Surface as manual_review_required.
create or replace function enqueue_won_without_provisioning_reviews(
  p_grace_hours int default 24
) returns int
language plpgsql
as $$
declare
  v_inserted int := 0;
begin
  with candidates as (
    select id
      from leads
     where lead_status = 'won'
       and (portal_invite_code is null or portal_invite_code = '')
       and won_at < now() - make_interval(hours => p_grace_hours)
       and not exists (
         select 1 from work_queue
          where work_queue.lead_id = leads.id
            and queue_type = 'won_onboarding_stalled'
            and status = 'pending'
       )
     limit 100
  )
  insert into work_queue (lead_id, queue_type, status, priority_level, queue_summary, reason, payload_json, created_by_actor_type)
  select id, 'won_onboarding_stalled', 'pending', 1,
         'Won > ' || p_grace_hours || 'h ago, no portal invite — provisioning stalled',
         'Auto-enqueued by enqueue_won_without_provisioning_reviews',
         jsonb_build_object('source', 'cron', 'grace_hours', p_grace_hours),
         'system'
    from candidates;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
