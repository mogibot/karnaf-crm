-- Karnaf CRM Core - Row Level Security.
--
-- Model:
--   * service_role (used by Edge Functions) bypasses RLS by default.
--   * authenticated users may READ operational data only if they have an
--     active profile with role in (owner, admin, mia, sales_rep, viewer).
--   * authenticated users may NOT directly write CRM data from the browser;
--     all writes flow through Edge Functions (service_role).
--   * anon role gets no access.
--
-- profiles: users may read their own profile; admin/owner may read all.

alter table profiles enable row level security;

drop policy if exists profiles_self_select on profiles;
create policy profiles_self_select on profiles
  for select to authenticated
  using (id = auth.uid() or public.has_role(array['owner','admin']::user_role[]));

drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles
  for update to authenticated
  using (public.has_role(array['owner','admin']::user_role[]))
  with check (public.has_role(array['owner','admin']::user_role[]));

-- Generic operational read policy for staff with an active profile.
create or replace function public.is_active_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(array['owner','admin','mia','sales_rep','viewer']::user_role[])
$$;

-- Tables that staff may read via the dashboard.
do $$
declare
  t text;
  staff_tables text[] := array[
    'leads','conversations','messages','lead_events','work_queue',
    'lead_tasks','payment_events','integration_logs','ai_decisions','crm_config'
  ];
begin
  foreach t in array staff_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_staff_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (public.is_active_staff())',
      t || '_staff_read', t
    );
  end loop;
end $$;

-- crm_config: writes only by owner/admin (still typically via Edge Function).
drop policy if exists crm_config_admin_write on crm_config;
create policy crm_config_admin_write on crm_config
  for all to authenticated
  using (public.has_role(array['owner','admin']::user_role[]))
  with check (public.has_role(array['owner','admin']::user_role[]));

-- Block any authenticated insert/update/delete on operational tables. The
-- absence of permissive policies for those commands already blocks them;
-- declare explicit no-op restrictive policies for clarity.
do $$
declare
  t text;
  staff_tables text[] := array[
    'leads','conversations','messages','lead_events','work_queue',
    'lead_tasks','payment_events','integration_logs','ai_decisions'
  ];
begin
  foreach t in array staff_tables loop
    execute format('drop policy if exists %I on %I', t || '_staff_no_write', t);
    execute format(
      'create policy %I on %I as restrictive for insert to authenticated with check (false)',
      t || '_staff_no_write', t
    );
  end loop;
end $$;
