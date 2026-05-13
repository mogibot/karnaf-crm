# Multi-product design (deferred refactor)

## Why this doc exists

The system is single-product today ("הדרך לדירה" / `derech_le_dira`).
Owner has signalled a second product will arrive in the future. The
data scaffolding lives in [migration 022](../supabase/migrations/022_multi_product_scaffold.sql)
so the moment a real second product is needed, the refactor is
focused on code rather than data plumbing under pressure.

## What is already in place (migration 022)

- `products` table with one seed row for `derech_le_dira`.
- `leads.product_id` — nullable FK, backfilled to the legacy product.
- `payment_events.product_id` — nullable FK, backfilled.
- `prompt_variants.product_id` — nullable FK, backfilled.
- Indexes on each product_id column.
- RLS: staff read, owner/admin write.

## What is still single-product (intentionally)

| Surface | Where | Note |
|---|---|---|
| AI prompt | `supabase/functions/_shared/ai-prompt.ts` | reads `ctx.runtimeConfig.product` (singleton) |
| Playbooks | `supabase/functions/_shared/playbooks.ts` | shared across products today; will likely stay shared, with optional overrides |
| Onboarding tasks | `supabase/migrations/010_dedup_and_onboarding.sql` `bootstrap_onboarding(lead_id)` | hard-coded Hebrew task copy |
| Forbidden claims | `crm_config.forbidden_claims` | global list |
| Knowledge base | `product_claims` table (Phase 1.2) | already scoped by `product_code` — multi-product-ready |
| Frontend analytics views | `v_source_performance`, `v_lead_cohorts`, etc. | aggregate across all leads |

## Activation checklist (when product #2 is ready)

1. Insert a new `products` row (code, display_name, prices).
2. Add a row to `product_claims` per claim for the new product.
3. Add intake routing: `leads-intake` accepts `?product=...` or
   `utm_product=...` and writes the resolved `product_id` to
   `leads.product_id` (today it skips the field).
4. Add payment routing: `payment-webhook` reads `product_code` from
   the provider payload, resolves to `product_id`, writes it to
   `payment_events.product_id` (column already exists; we just don't
   set it today).
5. Refactor `config-service.getRuntimeConfig()` to accept an optional
   product_id, fetch the product row from `products`, and merge
   `forbidden_claims_overrides` with the global list. Falls back to
   `derech_le_dira` when product_id is null (legacy leads).
6. Update `ai-prompt.buildAiSystemPrompt()` to receive the product
   object from the runtime config rather than the singleton path.
7. Update `bootstrap_onboarding` RPC to look up the right onboarding
   template per product (introduce an `onboarding_templates` table at
   that point; not yet created — schema sketch below).
8. Analytics: copy `v_source_performance` and `v_lead_cohorts` into
   `v_*_by_product` variants that GROUP BY product_id. Frontend adds
   a product dropdown above the analytics tables.
9. PromptVariants: extend the existing `lead_segment_filter` UI with
   a product dropdown that writes `prompt_variants.product_id` (the
   column already exists). The `pick_prompt_variant` RPC needs an
   extra arg for product matching.
10. Operator UX: add a product badge next to the lead name on
    LeadDetail and Leads list; add a "product" filter to Leads,
    Queue, Analytics.

## Schema sketch for the future `onboarding_templates` table

```sql
create table onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  task_count int not null,
  task_1_type text not null,
  task_1_title text not null,
  task_1_description text,
  task_1_owner_type text not null,
  task_1_due_hours int,
  task_2_type text,
  task_2_title text,
  task_2_description text,
  task_2_owner_type text,
  task_2_due_hours int,
  -- ...etc up to N tasks; or move to a child table if N is variable
  template_language text not null default 'he',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`bootstrap_onboarding(lead_id)` becomes
`bootstrap_onboarding(lead_id)` that reads
`leads.product_id → products.onboarding_template_id → onboarding_templates`
and renders the right tasks per product.

## Migration order when activating

1. New migration 023 (or whatever next is) — creates
   `onboarding_templates`, seeds derech_le_dira template, adds
   `products.onboarding_template_id` FK.
2. Migration 024 — refactors `bootstrap_onboarding` to be
   template-driven.
3. Code drop — config-service / ai-prompt / playbook plumbing.
4. Backfill: existing in-flight leads keep their legacy product_id.
5. Insert product #2 row + claims + template.
6. Wire intake + payment payload.
7. Add product filter UI to LeadsPage / AnalyticsPage / QueuePage.

## Risks

- Variant selection is currently keyed only by `playbook_name` +
  `is_active` + `weight`. Adding a `product_id` filter to
  `pick_prompt_variant` will break any variant rows that didn't get a
  backfill (already handled by migration 022).
- Existing analytics views are unscoped. Anyone running them after
  multi-product launches needs to interpret numbers carefully — date
  ranges + product filter must be applied together.
- Forbidden-claims merging needs explicit precedence rules (product
  overrides global? Or accumulate? Recommend: product OVERLAYS global
  for additions only, never removes a global ban).
