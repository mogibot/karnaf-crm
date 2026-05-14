-- Karnaf CRM Core - Saved lead filters.
--
-- Operators repeat the same filter combinations daily ("my hot leads",
-- "stale > 48h", "won this week"). Saving these as named bookmarks keeps
-- Mia from re-applying the same 3-4 selects every morning.
--
-- Scope is per-user by default; admins can mark a filter `is_shared=true`
-- so it appears in everyone's dropdown (e.g. "Phone-queue this week" as
-- a team-wide preset).

create table if not exists lead_saved_filters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  filter_json jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A user can't have two filters with the same name (avoids confusing
-- duplicates). Shared filters are still scoped per-owner — multiple admins
-- can each have a "Hot pipeline" preset.
create unique index if not exists ux_lsf_owner_name
  on lead_saved_filters (owner_id, name);

create index if not exists ix_lsf_shared
  on lead_saved_filters (is_shared)
  where is_shared = true;

alter table lead_saved_filters enable row level security;

-- Read: own filters always; shared filters from anyone if active staff.
create policy "read_own_or_shared_lsf" on lead_saved_filters
  for select using (
    owner_id = auth.uid()
    or (is_shared = true and is_active_staff())
  );

-- Insert: must be staff, and the owner_id must be the caller.
create policy "insert_own_lsf" on lead_saved_filters
  for insert with check (
    is_active_staff() and owner_id = auth.uid()
  );

-- Update / delete: own filters only (sharing flips remain owner-only).
create policy "update_own_lsf" on lead_saved_filters
  for update using (owner_id = auth.uid());
create policy "delete_own_lsf" on lead_saved_filters
  for delete using (owner_id = auth.uid());

-- Bump updated_at on writes — gives us a "last touched" view for cleanup.
create or replace function lead_saved_filters_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_lsf_touch on lead_saved_filters;
create trigger trg_lsf_touch before update on lead_saved_filters
  for each row execute function lead_saved_filters_touch();
