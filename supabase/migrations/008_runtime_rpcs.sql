-- Karnaf CRM Core - Runtime RPC helpers callable from Edge Functions.

-- Atomic upsert for inbound leads. Returns the lead row whether created or
-- found. Combined with the partial unique index on phone, this is race-safe.
create or replace function public.upsert_lead_by_phone(
  p_phone text,
  p_full_name text default null,
  p_source text default 'whatsapp',
  p_intake_channel text default 'whatsapp',
  p_metadata jsonb default '{}'::jsonb
) returns leads
language plpgsql security definer set search_path = public as $$
declare
  v_lead leads;
begin
  insert into leads(phone, full_name, source, intake_channel, raw_import_snapshot)
  values (p_phone, coalesce(p_full_name, 'ליד מוואטסאפ'), p_source, p_intake_channel, coalesce(p_metadata, '{}'::jsonb))
  on conflict (phone) where phone is not null
    do update set
      full_name = coalesce(leads.full_name, excluded.full_name),
      source = coalesce(nullif(leads.source, ''), excluded.source),
      updated_at = now()
  returning * into v_lead;

  if (v_lead.created_at = v_lead.updated_at) then
    insert into lead_events(lead_id, event_type, actor_type, event_payload)
    values (v_lead.id, 'lead_created', 'system', jsonb_build_object(
      'source', p_source, 'intake_channel', p_intake_channel
    ));
  end if;

  return v_lead;
end;
$$;
revoke all on function public.upsert_lead_by_phone(text,text,text,text,jsonb) from public;
grant execute on function public.upsert_lead_by_phone(text,text,text,text,jsonb) to service_role;

-- Per-conversation advisory locks. Edge Functions call try_lock at the top
-- of orchestration and release_lock before responding.
create or replace function public.try_conversation_lock(p_namespace int, p_key int) returns boolean
language sql as $$
  select pg_try_advisory_lock(p_namespace, p_key);
$$;
revoke all on function public.try_conversation_lock(int,int) from public;
grant execute on function public.try_conversation_lock(int,int) to service_role;

create or replace function public.release_conversation_lock(p_namespace int, p_key int) returns boolean
language sql as $$
  select pg_advisory_unlock(p_namespace, p_key);
$$;
revoke all on function public.release_conversation_lock(int,int) from public;
grant execute on function public.release_conversation_lock(int,int) to service_role;

-- Atomic lead_status transition that asserts the move is legal. Returns the
-- updated row, or NULL when the transition is rejected so the caller can
-- log a policy violation rather than silently overwriting state.
create or replace function public.transition_lead_status(
  p_lead_id uuid,
  p_target text,
  p_actor_type text default 'system',
  p_reason text default null
) returns leads
language plpgsql security definer set search_path = public as $$
declare
  v_current text;
  v_legal text[] := array[]::text[];
  v_lead leads;
begin
  select lead_status into v_current from leads where id = p_lead_id for update;
  if v_current is null then
    return null;
  end if;

  v_legal := case v_current
    when 'new' then array['first_contact_sent','manual_review_required','do_not_contact','removed_by_request']
    when 'first_contact_sent' then array['responded','nurture','human_handoff','lost','do_not_contact','removed_by_request']
    when 'responded' then array['qualified','nurture','checkout_pushed','human_handoff','lost','do_not_contact','removed_by_request']
    when 'qualified' then array['checkout_pushed','human_handoff','lost','do_not_contact','removed_by_request']
    when 'nurture' then array['responded','qualified','dormant','lost','do_not_contact','removed_by_request']
    when 'checkout_pushed' then array['payment_pending','won','human_handoff','lost','do_not_contact','removed_by_request']
    when 'payment_pending' then array['won','human_handoff','lost','do_not_contact','removed_by_request']
    when 'human_handoff' then array['responded','qualified','checkout_pushed','payment_pending','won','lost','do_not_contact','removed_by_request']
    when 'won' then array['onboarding_active','active_student']
    when 'lost' then array['nurture','dormant']
    when 'dormant' then array['responded','nurture','lost']
    when 'onboarding_active' then array['active_student']
    when 'manual_review_required' then array['first_contact_sent','human_handoff','lost','do_not_contact']
    else array[]::text[]
  end;

  if p_target = v_current then
    select * into v_lead from leads where id = p_lead_id;
    return v_lead;
  end if;

  if not p_target = any(v_legal) then
    insert into lead_events(lead_id, event_type, actor_type, event_payload)
    values (p_lead_id, 'state_transition_rejected', p_actor_type,
            jsonb_build_object('from', v_current, 'to', p_target, 'reason', p_reason));
    return null;
  end if;

  update leads set lead_status = p_target, updated_at = now() where id = p_lead_id
    returning * into v_lead;

  insert into lead_events(lead_id, event_type, actor_type, event_payload)
  values (p_lead_id, 'lead_status_changed', p_actor_type,
          jsonb_build_object('from', v_current, 'to', p_target, 'reason', p_reason));

  return v_lead;
end;
$$;
revoke all on function public.transition_lead_status(uuid,text,text,text) from public;
grant execute on function public.transition_lead_status(uuid,text,text,text) to service_role;
