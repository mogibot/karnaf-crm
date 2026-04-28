-- Karnaf CRM Core - First-user admin bootstrap.
--
-- The very first user signing up with the bootstrap email gets promoted to
-- `owner` automatically (active profile). Any subsequent signups land as
-- `viewer` with `is_active = true` per the existing trigger; an owner/admin
-- can then re-role them through the Users page.
--
-- The bootstrap email lives in crm_config so ops can tweak it via SQL
-- without redeploying. The promotion is gated on "no active owner exists",
-- so this is single-shot: once an owner is in place it never re-fires for
-- a recreated auth user. To re-bootstrap, demote/disable the existing
-- owner first.

insert into crm_config (config_key, config_value)
values ('bootstrap_admin_email', jsonb_build_object('email', 'mogibot1@gmail.com'))
on conflict (config_key) do nothing;

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_bootstrap_email text;
  v_has_owner boolean;
  v_is_bootstrap boolean;
begin
  select lower(coalesce(config_value->>'email', ''))
    into v_bootstrap_email
  from public.crm_config
  where config_key = 'bootstrap_admin_email';

  v_is_bootstrap := v_bootstrap_email is not null
    and v_bootstrap_email <> ''
    and lower(new.email) = v_bootstrap_email;

  select exists (
    select 1 from public.profiles where role = 'owner' and is_active
  ) into v_has_owner;

  if v_is_bootstrap and not v_has_owner then
    insert into public.profiles (id, email, role, is_active)
    values (new.id, new.email, 'owner', true)
    on conflict (id) do update
      set role = 'owner',
          is_active = true,
          email = coalesce(public.profiles.email, excluded.email),
          updated_at = now();
  else
    insert into public.profiles (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

-- Backfill: if the bootstrap user signed up before this migration ran, the
-- existing on_auth_user_created trigger created a `viewer` profile for them.
-- Promote it now, but only if there is still no active owner.
do $$
declare
  v_bootstrap_email text;
  v_uid uuid;
  v_has_owner boolean;
begin
  select lower(coalesce(config_value->>'email', ''))
    into v_bootstrap_email
  from public.crm_config
  where config_key = 'bootstrap_admin_email';

  if v_bootstrap_email is null or v_bootstrap_email = '' then
    return;
  end if;

  select exists (
    select 1 from public.profiles where role = 'owner' and is_active
  ) into v_has_owner;

  if v_has_owner then
    return;
  end if;

  select u.id into v_uid
  from auth.users u
  where lower(u.email) = v_bootstrap_email
  order by u.created_at asc
  limit 1;

  if v_uid is null then
    return;
  end if;

  insert into public.profiles (id, email, role, is_active)
  values (v_uid, v_bootstrap_email, 'owner', true)
  on conflict (id) do update
    set role = 'owner',
        is_active = true,
        updated_at = now();
end $$;
