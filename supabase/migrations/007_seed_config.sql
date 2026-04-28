-- Karnaf CRM Core - Seed runtime configuration.
-- Idempotent inserts driven by config_key uniqueness.

insert into crm_config (config_key, config_value)
values
  ('active_hours', jsonb_build_object('start','09:00','end','21:00','timezone','Asia/Jerusalem')),
  ('follow_up_delays', jsonb_build_object(
     'firstResponseMinutes', 30,
     'nurtureHours', 24,
     'paymentPendingHours', 12,
     'dormantDays', 30
  )),
  ('sla_thresholds', jsonb_build_object(
     'firstResponseWarnHours', 8,
     'firstResponseHighWarnHours', 10,
     'firstResponseBreachHours', 12,
     'paymentPendingHours', 24
  )),
  ('product', jsonb_build_object(
     'code','derech_le_dira',
     'displayName','הדרך לדירה',
     'priceMinIls', 3500,
     'priceTypicalIls', 4500
  )),
  ('forbidden_claims', jsonb_build_array(
     'תשואה מובטחת','מבטיח רווח','מובטח שתחסכו','מובטח שתצליחו','הבטחה לרכישה',
     'guaranteed return','guaranteed savings','guaranteed success','no risk','100% safe'
  )),
  ('ai_runtime', jsonb_build_object(
     'model','gpt-4o-mini',
     'promptVersion','v1',
     'maxReplyChars', 900,
     'circuitBreakerCooldownMinutes', 5,
     'circuitBreakerFailureThreshold', 3
  )),
  ('whatsapp_session', jsonb_build_object(
     'freeformWindowHours', 24,
     'fallbackTemplateName','karnaf_followup_v1'
  ))
on conflict (config_key) do nothing;
