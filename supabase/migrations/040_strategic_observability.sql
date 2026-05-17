-- 034_strategic_observability.sql
-- Strategic tier of the CRM cleanup plan (Tier 3):
--   * Surface which AI playbook the lead is currently sitting in so a human
--     reviewer can tell at a glance where the bot is in the script.
--   * Track when the playbook last advanced.
-- Additive only.

alter table leads
  add column if not exists ai_playbook_stage text,
  add column if not exists ai_playbook_stage_at timestamptz;

create index if not exists idx_leads_ai_playbook_stage on leads(ai_playbook_stage);
