-- Karnaf CRM Core - Multi-product scaffolding.
--
-- Lays the data foundations for a multi-product future without
-- refactoring runtime code today. The system is still single-product
-- (the AI prompt + playbooks still read crm_config.product); this
-- migration just gives us the FKs we will need so the moment a second
-- product launches we can extend the runtime without backfilling rows
-- under pressure.
--
-- Strategy:
--   * Create a `products` table seeded with the legacy product
--     ('derech_le_dira') exactly as `crm_config.product` describes it.
--   * Add `product_id uuid` (NULLABLE FK) to leads, payment_events,
--     prompt_variants. Backfill rows belonging to the legacy product so
--     when we later flip the column to NOT NULL it is a one-liner.
--   * No code changes in this migration; runtime keeps using
--     crm_config.product (single source of truth) until the multi-
--     product refactor lands.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  slug text generated always as (lower(regexp_replace(code, '[^a-z0-9_-]+', '-', 'g'))) stored,
  description text,
  price_min_cents int not null default 0,
  price_typical_cents int not null default 0,
  currency text not null default 'ILS',
  ai_persona_hints jsonb not null default '{}'::jsonb,
  forbidden_claims_overrides jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  launch_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references profiles(id) on delete set null
);

alter table products enable row level security;
drop policy if exists products_staff_read on products;
create policy products_staff_read on products
  for select to authenticated using (public.is_active_staff());
drop policy if exists products_admin_write on products;
create policy products_admin_write on products
  for all to authenticated
  using (public.has_role(array['owner','admin']::user_role[]))
  with check (public.has_role(array['owner','admin']::user_role[]));

drop trigger if exists trg_products_set_updated_at on products;
create trigger trg_products_set_updated_at
  before update on products
  for each row execute function public.set_updated_at();

-- Seed the legacy product from the crm_config.product row so existing
-- pricing/displayName stay the single source of truth. Idempotent.
insert into products (code, display_name, price_min_cents, price_typical_cents)
values ('derech_le_dira', 'הדרך לדירה', 350000, 450000)
on conflict (code) do nothing;

-- Add nullable product_id FKs to the four tables that will eventually
-- need to scope by product. Each FK is `on delete set null` so deleting
-- a product (rare) doesn't cascade-destroy leads / payments / variants.

alter table leads
  add column if not exists product_id uuid references products(id) on delete set null;

alter table payment_events
  add column if not exists product_id uuid references products(id) on delete set null;

alter table prompt_variants
  add column if not exists product_id uuid references products(id) on delete set null;

-- Backfill existing rows so they point at the legacy product. New
-- inserts will keep the column null until the multi-product refactor
-- ships, at which point we'll flip it to NOT NULL with a fresh
-- migration.
update leads
   set product_id = (select id from products where code = 'derech_le_dira')
 where product_id is null;

update payment_events
   set product_id = (select id from products where code = 'derech_le_dira')
 where product_id is null;

update prompt_variants
   set product_id = (select id from products where code = 'derech_le_dira')
 where product_id is null;

create index if not exists idx_leads_product_id on leads(product_id);
create index if not exists idx_payment_events_product_id on payment_events(product_id);
create index if not exists idx_prompt_variants_product_id on prompt_variants(product_id);
