-- Karnaf CRM Core - Score decay + GDPR PII retention helpers.

-- Lead score loses 1 point per week of inactivity for active leads. This
-- prevents stale leads from clinging to a high score from a long-past
-- interaction.
create or replace function public.apply_lead_score_decay() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  with updated as (
    update leads set lead_score = greatest(0, lead_score - 1)
    where lead_status not in ('won','lost','do_not_contact','removed_by_request',
                               'active_student','onboarding_active','duplicate')
      and updated_at < now() - interval '7 days'
      and lead_score > 0
    returning id
  )
  select count(*)::int into v_count from updated;
  return v_count;
end;
$$;
revoke all on function public.apply_lead_score_decay() from public;
grant execute on function public.apply_lead_score_decay() to service_role;

-- Anonymise PII for leads removed_by_request older than the retention
-- window. The lead row itself stays for analytics integrity (counts,
-- timestamps), but identifying fields are wiped.
create or replace function public.purge_removed_pii(p_retention_days int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  with updated as (
    update leads set
      full_name = '[redacted]',
      email = null,
      phone = null,
      city = null,
      notes_internal = null,
      pain_point_summary = null,
      goal_summary = null,
      conversation_summary = null,
      raw_import_snapshot = '{}'::jsonb
    where removed_by_request = true
      and updated_at < now() - make_interval(days => p_retention_days)
      and full_name is distinct from '[redacted]'
    returning id
  )
  select count(*)::int into v_count from updated;
  return v_count;
end;
$$;
revoke all on function public.purge_removed_pii(int) from public;
grant execute on function public.purge_removed_pii(int) to service_role;

-- Compact integration_logs older than 14 days (keep error rows, drop
-- successful payloads to preserve disk space).
create or replace function public.compact_integration_logs(p_keep_days int default 14) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  with deleted as (
    delete from integration_logs
    where status = 'success' and created_at < now() - make_interval(days => p_keep_days)
    returning 1
  )
  select count(*)::int into v_count from deleted;
  return v_count;
end;
$$;
revoke all on function public.compact_integration_logs(int) from public;
grant execute on function public.compact_integration_logs(int) to service_role;
