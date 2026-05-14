-- Karnaf CRM Core - Prompt-variant change-request flow.
--
-- Operators (mia tier) shouldn't be able to mutate prompt variants
-- directly — that's a "deploy to AI" action and needs an admin in the
-- loop. But blocking them from the page entirely (current behaviour)
-- means the nav lies: they see "/admin/prompts" in the sidebar then get
-- redirected on click.
--
-- This migration adds a request queue that mia can submit into, which
-- admins then accept/decline from the same page. The change is
-- non-destructive — admins still have full direct-edit power.

create table if not exists prompt_variant_change_requests (
  id uuid primary key default gen_random_uuid(),
  -- nullable when the request is "create a brand-new variant" (no
  -- existing id yet) — admin fills it in on accept.
  variant_id uuid references prompt_variants(id) on delete set null,
  playbook_name text not null,
  -- One of: 'tweak_objective', 'tweak_guidance', 'change_weight',
  -- 'activate', 'deactivate', 'create_new', 'remove'.
  request_kind text not null,
  -- Free-form rationale ("AI keeps offering financing to leads who
  -- already asked us to stop") — Hebrew/English allowed.
  rationale text not null,
  -- Structured proposed change (varies by kind). Stored as jsonb so we
  -- can extend later without migration.
  proposed_change jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','superseded')),
  requested_by uuid not null references profiles(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  reviewer_note text
);

create index if not exists ix_pvcr_status_requested
  on prompt_variant_change_requests (status, requested_at desc);

create index if not exists ix_pvcr_variant
  on prompt_variant_change_requests (variant_id)
  where variant_id is not null;

-- RLS — readable by all staff, writable per role: any staff can insert,
-- only owner/admin can update (accept/decline). Migration 005 already
-- enabled RLS infrastructure + `is_active_staff()` helper.
alter table prompt_variant_change_requests enable row level security;

create policy "staff_read_pvcr" on prompt_variant_change_requests
  for select using (is_active_staff());

create policy "staff_insert_pvcr" on prompt_variant_change_requests
  for insert with check (is_active_staff() and requested_by = auth.uid());

create policy "admin_update_pvcr" on prompt_variant_change_requests
  for update using (
    is_active_staff()
    and exists (select 1 from profiles p
                where p.id = auth.uid()
                  and p.role in ('owner','admin')
                  and p.is_active = true)
  );
