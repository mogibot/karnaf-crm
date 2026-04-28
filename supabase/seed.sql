-- Local development seed. Re-runnable.
-- Creates a sample mia profile if a corresponding auth user already exists.

do $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where email = 'mia@karnaf.local' limit 1;
  if v_uid is not null then
    insert into profiles (id, email, full_name, role, is_active)
    values (v_uid, 'mia@karnaf.local', 'Mia (dev)', 'mia', true)
    on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  end if;
end $$;
