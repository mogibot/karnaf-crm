-- Karnaf CRM Core - Email-based dedup, smart upsert, onboarding bootstrap.

-- Email is now a unique identity column too (case-insensitive). We keep
-- the existing phone uniqueness so a lead reachable on either contact
-- channel collapses to a single row.
create unique index if not exists ux_leads_email_active
  on leads(lower(email)) where email is not null;

-- Extend the queue_type constraint with onboarding_action for post-`won` flows.
alter table work_queue drop constraint if exists work_queue_queue_type_check;
alter table work_queue add constraint work_queue_queue_type_check check (queue_type in (
  'first_response_due','hot_lead','sla_risk','human_handoff','payment_pending',
  'phone_escalation','nurture_due','dormant_review','failed_automation',
  'weekend_carryover','low_fit_cleanup','manual_review_required','onboarding_action'
));

-- Smart upsert: tries phone first (preferred identity for WhatsApp), falls
-- back to email, then creates a new row. Backfills missing fields without
-- overwriting existing data.
create or replace function public.upsert_lead_smart(
  p_phone text,
  p_email text,
  p_full_name text default null,
  p_source text default 'unknown',
  p_intake_channel text default 'form',
  p_metadata jsonb default '{}'::jsonb
) returns leads
language plpgsql security definer set search_path = public as $$
declare
  v_lead leads;
  v_email text := nullif(lower(coalesce(p_email, '')), '');
begin
  if p_phone is not null and p_phone <> '' then
    select * into v_lead from leads where phone = p_phone limit 1;
    if found then
      update leads set
        full_name = coalesce(full_name, p_full_name),
        email = coalesce(email, v_email),
        updated_at = now()
      where id = v_lead.id
      returning * into v_lead;
      return v_lead;
    end if;
  end if;

  if v_email is not null then
    select * into v_lead from leads where lower(email) = v_email limit 1;
    if found then
      update leads set
        phone = coalesce(phone, p_phone),
        full_name = coalesce(full_name, p_full_name),
        updated_at = now()
      where id = v_lead.id
      returning * into v_lead;
      return v_lead;
    end if;
  end if;

  insert into leads (phone, email, full_name, source, intake_channel, raw_import_snapshot)
  values (p_phone, v_email, coalesce(p_full_name, 'ליד חדש'), p_source, p_intake_channel, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_lead;

  insert into lead_events(lead_id, event_type, actor_type, event_payload)
  values (v_lead.id, 'lead_created', 'system', jsonb_build_object(
    'source', p_source, 'intake_channel', p_intake_channel
  ));
  return v_lead;
end;
$$;
revoke all on function public.upsert_lead_smart(text,text,text,text,text,jsonb) from public;
grant execute on function public.upsert_lead_smart(text,text,text,text,text,jsonb) to service_role;

-- Bootstrap a fresh onboarding flow whenever a lead lands in `won`. Idempotent:
-- existing onboarding queue/task entries are not duplicated.
create or replace function public.bootstrap_onboarding(p_lead_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into work_queue (lead_id, queue_type, priority_level, status, reason, created_by_actor_type, payload_json)
  select p_lead_id, 'onboarding_action', 2, 'pending',
         'אתחול אונבורדינג לתלמיד חדש', 'system',
         jsonb_build_object('flow', 'onboarding_kickoff')
  where not exists (
    select 1 from work_queue
    where lead_id = p_lead_id and queue_type = 'onboarding_action' and status in ('pending','claimed')
  );

  insert into lead_tasks (lead_id, task_type, task_status, owner_type, title, description, priority_level, due_at, payload_json)
  select p_lead_id, 'onboarding', 'open', 'mia',
         'שליחת גישה ללומד', 'יצירת חשבון בפלטפורמה ושליחת קישור גישה',
         2, now() + interval '24 hours',
         jsonb_build_object('flow', 'onboarding_kickoff')
  where not exists (
    select 1 from lead_tasks
    where lead_id = p_lead_id and task_type = 'onboarding' and task_status = 'open'
  );

  insert into lead_tasks (lead_id, task_type, task_status, owner_type, title, description, priority_level, due_at, payload_json)
  select p_lead_id, 'onboarding_followup', 'open', 'ai',
         'מעקב יום 3', 'בדיקה שהתחיל בפועל את הצפייה',
         3, now() + interval '3 days',
         jsonb_build_object('flow', 'onboarding_kickoff')
  where not exists (
    select 1 from lead_tasks
    where lead_id = p_lead_id and task_type = 'onboarding_followup' and task_status = 'open'
  );
end;
$$;
revoke all on function public.bootstrap_onboarding(uuid) from public;
grant execute on function public.bootstrap_onboarding(uuid) to service_role;

-- Trigger: fire onboarding bootstrap when a lead transitions into `won`.
create or replace function public.trg_bootstrap_onboarding_on_won() returns trigger
language plpgsql as $$
begin
  if new.lead_status = 'won' and (old.lead_status is distinct from 'won') then
    perform public.bootstrap_onboarding(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_bootstrap_onboarding on leads;
create trigger trg_leads_bootstrap_onboarding
  after update on leads
  for each row execute function public.trg_bootstrap_onboarding_on_won();
