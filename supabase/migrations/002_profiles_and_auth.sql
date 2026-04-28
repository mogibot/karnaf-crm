-- Karnaf CRM Core - Profiles, roles, and integration with Supabase auth.

create extension if not exists pgcrypto;

do $$ begin
  create type user_role as enum ('owner', 'admin', 'mia', 'sales_rep', 'viewer');
exception when duplicate_object then null; end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role user_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on profiles(role) where is_active;

-- Maintain a profile row whenever an auth user is created.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Helper: current authenticated user's role, used by RLS policies.
create or replace function public.current_user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

-- Helper: user has any of the given roles.
create or replace function public.has_role(roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = any(roles), false)
$$;

-- Foreign keys to profiles for ownership/assignment columns.
do $$ begin
  alter table leads
    add constraint leads_human_owner_profile_fk
    foreign key (human_owner_id) references profiles(id) on delete set null;
exception when duplicate_object then null; when invalid_foreign_key then null; end $$;

do $$ begin
  alter table conversations
    add constraint conversations_current_handler_profile_fk
    foreign key (current_handler_id) references profiles(id) on delete set null;
exception when duplicate_object then null; when invalid_foreign_key then null; end $$;

do $$ begin
  alter table work_queue
    add constraint work_queue_assigned_profile_fk
    foreign key (assigned_to_user_id) references profiles(id) on delete set null;
exception when duplicate_object then null; when invalid_foreign_key then null; end $$;

do $$ begin
  alter table lead_tasks
    add constraint lead_tasks_owner_profile_fk
    foreign key (owner_user_id) references profiles(id) on delete set null;
exception when duplicate_object then null; when invalid_foreign_key then null; end $$;

do $$ begin
  alter table crm_config
    add constraint crm_config_updated_by_profile_fk
    foreign key (updated_by_user_id) references profiles(id) on delete set null;
exception when duplicate_object then null; when invalid_foreign_key then null; end $$;
