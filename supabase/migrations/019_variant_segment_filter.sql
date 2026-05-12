-- Karnaf CRM Core - Per-segment A/B prompt variant rollout.
--
-- prompt_variants gets a `lead_segment_filter` JSONB column so a variant
-- can be scoped to a subset of leads (e.g. only hot leads, or only
-- webinar-source leads, or only responded-status leads). The selector
-- accepts lead heat/source/status and filters eligible variants before
-- weighted random pick. A variant with an empty filter matches every
-- lead.
--
-- Filter schema (all keys optional):
--   { "heat": ["hot","warm"], "source": ["webinar"], "status": ["responded"] }
-- A key with an empty array is treated as no-constraint. Filter values
-- are case-sensitive and must match the lead column verbatim.

alter table prompt_variants
  add column if not exists lead_segment_filter jsonb not null default '{}'::jsonb;

-- Replace the selector to accept lead context. Keeping the old signature
-- callable is unnecessary: only the runtime and the operator UI call it,
-- and both will pass nulls when the lead's segment is unknown.
drop function if exists public.pick_prompt_variant(text);

create or replace function public.pick_prompt_variant(
  p_playbook text,
  p_lead_heat text default null,
  p_lead_source text default null,
  p_lead_status text default null
)
returns table(version text, weight int, prompt_overrides jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_total int;
  v_threshold int;
begin
  with eligible as (
    select pv.version, pv.weight, pv.prompt_overrides
    from prompt_variants pv
    where pv.playbook_name = p_playbook
      and pv.is_active
      and pv.weight > 0
      and (
        not (pv.lead_segment_filter ? 'heat')
        or jsonb_array_length(coalesce(pv.lead_segment_filter->'heat', '[]'::jsonb)) = 0
        or p_lead_heat is null
        or pv.lead_segment_filter->'heat' @> to_jsonb(p_lead_heat)
      )
      and (
        not (pv.lead_segment_filter ? 'source')
        or jsonb_array_length(coalesce(pv.lead_segment_filter->'source', '[]'::jsonb)) = 0
        or p_lead_source is null
        or pv.lead_segment_filter->'source' @> to_jsonb(p_lead_source)
      )
      and (
        not (pv.lead_segment_filter ? 'status')
        or jsonb_array_length(coalesce(pv.lead_segment_filter->'status', '[]'::jsonb)) = 0
        or p_lead_status is null
        or pv.lead_segment_filter->'status' @> to_jsonb(p_lead_status)
      )
  )
  select coalesce(sum(weight), 0) into v_total from eligible;

  if v_total <= 0 then return; end if;

  v_threshold := floor(random() * v_total)::int;

  return query
  with ranked as (
    select e.version, e.weight, e.prompt_overrides,
           sum(e.weight) over (order by e.version) - e.weight as cumulative_low,
           sum(e.weight) over (order by e.version) as cumulative_high
    from eligible e
  )
  select r.version, r.weight, r.prompt_overrides
  from ranked r
  where v_threshold >= r.cumulative_low and v_threshold < r.cumulative_high
  limit 1;
end;
$$;

revoke all on function public.pick_prompt_variant(text, text, text, text) from public;
grant execute on function public.pick_prompt_variant(text, text, text, text) to service_role;
