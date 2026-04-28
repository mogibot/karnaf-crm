-- Karnaf CRM Core - Email channel hint + transcript summary config.
--
-- The `channel` enum already accepts 'email' (see migration 003), so all
-- this migration does is seed runtime config keys the orchestrator and
-- transcript-summary helpers consult. Idempotent — re-runs are no-ops.

insert into crm_config (config_key, config_value)
values
  ('email_inbox', jsonb_build_object(
     'fromAddress', 'crm@karnaf.local',
     'replyHandlingMode', 'queue_for_mia'
  )),
  ('summary_runtime', jsonb_build_object(
     'mode', 'heuristic',
     'minMessages', 10,
     'modelTemperature', 0.2,
     'maxOutputChars', 1200
  ))
on conflict (config_key) do nothing;
