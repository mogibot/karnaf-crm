-- Karnaf CRM Core - A/B prompt variant rollout.
--
-- A `prompt_variants` row defines a (playbook_name, version) pair with a
-- weight 0-100. The runtime consults `pick_prompt_variant(playbook_name)`
-- which returns one variant chosen by weighted random selection. The
-- chosen version is recorded in ai_decisions.prompt_version, so existing
-- analytics can already group conversions per variant. Variants with
-- weight 0 are off; sum across active variants need not equal 100 — the
-- selector normalises.

create table if not exists prompt_variants (
  id uuid primary key default gen_random_uuid(),
  playbook_name text not null,
  version text not null,
  weight int not null default 0,
  prompt_overrides jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references profiles(id) on delete set null,
  unique (playbook_name, version)
);

create index if not exists idx_prompt_variants_playbook_active
  on prompt_variants(playbook_name) where is_active;

alter table prompt_variants enable row level security;

drop policy if exists prompt_variants_staff_read on prompt_variants;
create policy prompt_variants_staff_read on prompt_variants
  for select to authenticated using (public.is_active_staff());

drop policy if exists prompt_variants_admin_write on prompt_variants;
create policy prompt_variants_admin_write on prompt_variants
  for all to authenticated
  using (public.has_role(array['owner','admin']::user_role[]))
  with check (public.has_role(array['owner','admin']::user_role[]));

drop trigger if exists trg_prompt_variants_set_updated_at on prompt_variants;
create trigger trg_prompt_variants_set_updated_at
  before update on prompt_variants
  for each row execute function public.set_updated_at();

-- Weighted selector. Returns NULL when no active variant exists for the
-- playbook so the caller can fall back to its hard-coded default.
create or replace function public.pick_prompt_variant(p_playbook text)
returns table(version text, weight int, prompt_overrides jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_total int;
  v_threshold int;
begin
  select coalesce(sum(weight), 0) into v_total
  from prompt_variants
  where playbook_name = p_playbook and is_active and weight > 0;

  if v_total <= 0 then return; end if;

  v_threshold := floor(random() * v_total)::int;

  return query
  with ranked as (
    select pv.version, pv.weight, pv.prompt_overrides,
           sum(pv.weight) over (order by pv.version) - pv.weight as cumulative_low,
           sum(pv.weight) over (order by pv.version) as cumulative_high
    from prompt_variants pv
    where pv.playbook_name = p_playbook and pv.is_active and pv.weight > 0
  )
  select r.version, r.weight, r.prompt_overrides
  from ranked r
  where v_threshold >= r.cumulative_low and v_threshold < r.cumulative_high
  limit 1;
end;
$$;
revoke all on function public.pick_prompt_variant(text) from public;
grant execute on function public.pick_prompt_variant(text) to service_role;

-- Per-variant outcome aggregation, joined to leads for win-rate analysis.
create or replace view v_prompt_variant_outcomes as
select
  d.prompt_version,
  d.playbook_name,
  count(*)::int as decisions_total,
  count(*) filter (where d.execution_status = 'openai_success')::int as success_total,
  count(*) filter (where d.execution_status = 'validation_blocked')::int as blocked_total,
  count(distinct d.lead_id)::int as leads_touched,
  count(distinct l.id) filter (where l.lead_status = 'won')::int as leads_won,
  count(distinct l.id) filter (where l.lead_status = 'lost')::int as leads_lost
from ai_decisions d
left join leads l on l.id = d.lead_id
where d.prompt_version is not null
group by d.prompt_version, d.playbook_name;
