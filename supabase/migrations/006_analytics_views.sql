-- Karnaf CRM Core - Analytics views and helper RPCs.

-- Source performance: counts and conversion ratios per source.
create or replace view v_source_performance as
select
  source,
  count(*)::int as leads_total,
  count(*) filter (where lead_status not in ('new')) ::int as leads_engaged,
  count(*) filter (where lead_status = 'qualified') ::int as leads_qualified,
  count(*) filter (where lead_status = 'checkout_pushed') ::int as leads_checkout_pushed,
  count(*) filter (where lead_status = 'won') ::int as leads_won,
  count(*) filter (where lead_status = 'lost') ::int as leads_lost,
  case when count(*) > 0
       then round(100.0 * count(*) filter (where lead_status = 'won') / count(*), 2)
       else 0 end as win_rate_pct
from leads
group by source;

-- Conversion funnel snapshot.
create or replace view v_conversion_funnel as
select
  count(*) filter (where lead_status = 'new') ::int as new_count,
  count(*) filter (where lead_status = 'first_contact_sent') ::int as first_contact_count,
  count(*) filter (where lead_status = 'responded') ::int as responded_count,
  count(*) filter (where lead_status = 'qualified') ::int as qualified_count,
  count(*) filter (where lead_status = 'checkout_pushed') ::int as checkout_count,
  count(*) filter (where lead_status = 'payment_pending') ::int as payment_pending_count,
  count(*) filter (where lead_status = 'won') ::int as won_count,
  count(*) filter (where lead_status = 'lost') ::int as lost_count,
  count(*) filter (where lead_status = 'dormant') ::int as dormant_count
from leads
where coalesce(do_not_contact, false) = false
  and coalesce(removed_by_request, false) = false;

-- Lead aging: time spent in each lead_status (last update).
create or replace view v_lead_aging as
select
  id as lead_id,
  lead_status,
  lead_heat,
  ownership_mode,
  source,
  extract(epoch from (now() - updated_at))::bigint / 60 as minutes_in_state,
  last_inbound_at,
  last_outbound_at
from leads
where lead_status not in ('won','lost','dormant','do_not_contact','removed_by_request');

-- Recent activity feed (last 24h).
create or replace view v_recent_activity as
select
  e.id, e.lead_id, e.event_type, e.actor_type, e.created_at,
  l.full_name, l.phone, l.lead_status, l.lead_heat
from lead_events e
join leads l on l.id = e.lead_id
where e.created_at > now() - interval '24 hours'
order by e.created_at desc;

-- AI vs Mia outcome comparison (won leads grouped by who last touched).
create or replace view v_ai_vs_mia_outcomes as
select
  case
    when last_human_touch_at is null and last_ai_touch_at is not null then 'ai_only'
    when last_human_touch_at is not null and last_ai_touch_at is null then 'human_only'
    when last_human_touch_at > coalesce(last_ai_touch_at, '-infinity'::timestamptz) then 'human_last'
    else 'ai_last'
  end as touch_pattern,
  lead_status,
  count(*)::int as leads_count
from leads
where lead_status in ('won','lost')
group by 1, 2;

-- Helper RPC: dashboard summary in one round-trip.
create or replace function public.dashboard_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  with funnel as (select * from v_conversion_funnel),
       today_leads as (
         select count(*)::int as c from leads where created_at::date = current_date
       ),
       unanswered as (
         select count(*)::int as c from leads
         where lead_status in ('new','first_contact_sent')
           and coalesce(do_not_contact,false) = false
           and coalesce(removed_by_request,false) = false
       ),
       hot as (
         select count(*)::int as c from leads
         where lead_heat = 'hot'
           and lead_status not in ('won','lost','do_not_contact','removed_by_request')
       ),
       payment_pending as (
         select count(*)::int as c from leads where lead_status = 'payment_pending'
       ),
       sla_at_risk as (
         select count(*)::int as c from leads
         where last_inbound_at is not null
           and (last_outbound_at is null or last_outbound_at < last_inbound_at)
           and last_inbound_at < now() - interval '8 hours'
           and coalesce(do_not_contact,false) = false
           and coalesce(removed_by_request,false) = false
       ),
       queue_counts as (
         select queue_type, count(*)::int as c from work_queue where status = 'pending' group by queue_type
       )
  select jsonb_build_object(
    'leadsToday', (select c from today_leads),
    'unansweredNow', (select c from unanswered),
    'hotLeadsNow', (select c from hot),
    'paymentPendingNow', (select c from payment_pending),
    'slaRiskCount', (select c from sla_at_risk),
    'funnel', to_jsonb((select f from funnel f)),
    'queueCounts', coalesce((select jsonb_object_agg(queue_type, c) from queue_counts), '{}'::jsonb)
  );
$$;

revoke all on function public.dashboard_summary() from public;
grant execute on function public.dashboard_summary() to authenticated, service_role;
