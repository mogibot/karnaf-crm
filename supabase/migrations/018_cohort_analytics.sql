-- Karnaf CRM Core - Cohort + funnel-time analytics views.
--
-- v_lead_cohorts groups leads by signup ISO-week so we can see how each
-- intake cohort matures over time (responded -> qualified -> won).
--
-- v_first_response_times measures the gap between the first inbound and
-- the first AI/human outbound per source — directly answers "are we
-- meeting the SLA?".
--
-- Both views are read-only and inherit RLS from the underlying tables.

create or replace view v_lead_cohorts as
with cohort as (
  select
    date_trunc('week', l.created_at)::date as cohort_week,
    l.source,
    l.id as lead_id,
    l.lead_status,
    l.lead_score,
    l.created_at,
    l.won_at
  from leads l
  where coalesce(l.removed_by_request, false) = false
)
select
  cohort_week,
  source,
  count(*)::int as leads_total,
  count(*) filter (where lead_status = 'responded') ::int as responded,
  count(*) filter (where lead_status = 'qualified') ::int as qualified,
  count(*) filter (where lead_status = 'checkout_pushed') ::int as checkout_pushed,
  count(*) filter (where lead_status = 'won') ::int as won,
  count(*) filter (where lead_status = 'lost') ::int as lost,
  case when count(*) > 0
       then round(100.0 * count(*) filter (where lead_status = 'won') / count(*), 2)
       else 0 end as win_rate_pct,
  -- avg minutes to win (only over actually-won leads)
  coalesce(
    avg(extract(epoch from (won_at - created_at)) / 60.0)
      filter (where lead_status = 'won' and won_at is not null),
    0
  )::int as avg_minutes_to_win
from cohort
group by cohort_week, source
order by cohort_week desc, source;

-- For first-response SLA tracking. We look at each lead's first inbound
-- (last_inbound_at is updated by trigger but not the first one — so we
-- use the messages table directly) versus the first outbound. Result is
-- minutes elapsed; null when one side is missing.
create or replace view v_first_response_times as
with firsts as (
  select
    m.lead_id,
    min(m.created_at) filter (where m.direction = 'inbound') as first_inbound_at,
    min(m.created_at) filter (where m.direction = 'outbound') as first_outbound_at
  from messages m
  group by m.lead_id
)
select
  l.source,
  count(*) filter (where f.first_inbound_at is not null and f.first_outbound_at is not null)::int as measured_leads,
  -- minutes
  coalesce(
    percentile_cont(0.5) within group (order by extract(epoch from (f.first_outbound_at - f.first_inbound_at)) / 60.0)
      filter (where f.first_inbound_at is not null and f.first_outbound_at is not null),
    0
  )::int as p50_minutes,
  coalesce(
    percentile_cont(0.9) within group (order by extract(epoch from (f.first_outbound_at - f.first_inbound_at)) / 60.0)
      filter (where f.first_inbound_at is not null and f.first_outbound_at is not null),
    0
  )::int as p90_minutes,
  coalesce(
    max(extract(epoch from (f.first_outbound_at - f.first_inbound_at)) / 60.0)
      filter (where f.first_inbound_at is not null and f.first_outbound_at is not null),
    0
  )::int as max_minutes,
  count(*) filter (where f.first_inbound_at is not null and f.first_outbound_at is null)::int as unanswered_leads
from leads l
left join firsts f on f.lead_id = l.id
where coalesce(l.removed_by_request, false) = false
group by l.source
order by l.source;
