-- Karnaf CRM Core - Enum check constraints, unique constraints, additional indexes.

-- Lead status / heat / ownership: enforce controlled vocabulary.
do $$ begin
  alter table leads add constraint leads_lead_status_check check (lead_status in (
    'new','first_contact_sent','responded','qualified','nurture','checkout_pushed',
    'payment_pending','human_handoff','won','lost','dormant','onboarding_active',
    'active_student','do_not_contact','removed_by_request','duplicate','manual_review_required'
  ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table leads add constraint leads_lead_heat_check check (lead_heat in ('hot','warm','cool','cold'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table leads add constraint leads_ownership_mode_check check (ownership_mode in (
    'ai_active','mia_active','phone_sales_pending','shared_watch','suppressed'
  ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table leads add constraint leads_lead_score_range check (lead_score between 0 and 100);
exception when duplicate_object then null; end $$;

-- Conversations
do $$ begin
  alter table conversations add constraint conversations_channel_check check (channel in (
    'whatsapp','instagram','email','manual','sms','other'
  ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table conversations add constraint conversations_ownership_mode_check check (ownership_mode in (
    'ai_active','mia_active','phone_sales_pending','shared_watch','suppressed'
  ));
exception when duplicate_object then null; end $$;

-- Messages
do $$ begin
  alter table messages add constraint messages_sender_type_check check (sender_type in (
    'lead','ai','mia','sales_rep','system','admin'
  ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table messages add constraint messages_direction_check check (direction in ('inbound','outbound','internal'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table messages add constraint messages_message_type_check check (message_type in (
    'text','media','template','system_event'
  ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table messages add constraint messages_provider_status_check check (
    provider_status is null or provider_status in ('queued','sent','delivered','read','failed')
  );
exception when duplicate_object then null; end $$;

-- Work queue
do $$ begin
  alter table work_queue add constraint work_queue_queue_type_check check (queue_type in (
    'first_response_due','hot_lead','sla_risk','human_handoff','payment_pending',
    'phone_escalation','nurture_due','dormant_review','failed_automation',
    'weekend_carryover','low_fit_cleanup','manual_review_required'
  ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table work_queue add constraint work_queue_status_check check (status in (
    'pending','claimed','resolved','canceled'
  ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table work_queue add constraint work_queue_priority_check check (priority_level between 1 and 5);
exception when duplicate_object then null; end $$;

-- Lead tasks
do $$ begin
  alter table lead_tasks add constraint lead_tasks_task_status_check check (task_status in (
    'open','done','canceled','expired'
  ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table lead_tasks add constraint lead_tasks_owner_type_check check (owner_type in (
    'ai','mia','sales_rep','system','admin'
  ));
exception when duplicate_object then null; end $$;

-- Lead events
do $$ begin
  alter table lead_events add constraint lead_events_actor_type_check check (actor_type in (
    'ai','mia','sales_rep','system','admin','provider','owner'
  ));
exception when duplicate_object then null; end $$;

-- AI decisions
do $$ begin
  alter table ai_decisions add constraint ai_decisions_status_check check (execution_status in (
    'openai_success','openai_error','openai_empty_content','openai_exception',
    'circuit_open','validation_blocked','suppressed','no_send','model_disabled'
  ));
exception when duplicate_object then null; end $$;

-- Unique constraints to prevent duplicates and races.
create unique index if not exists ux_leads_phone_active
  on leads(phone) where phone is not null;

create unique index if not exists ux_messages_provider_message_id
  on messages(provider_message_id) where provider_message_id is not null;

create unique index if not exists ux_payment_events_external_order_id
  on payment_events(external_order_id) where external_order_id is not null;

-- Additional indexes for common query patterns.
create index if not exists idx_leads_ownership_status on leads(ownership_mode, lead_status);
create index if not exists idx_leads_last_inbound_at on leads(last_inbound_at) where last_inbound_at is not null;
create index if not exists idx_leads_last_outbound_at on leads(last_outbound_at) where last_outbound_at is not null;
create index if not exists idx_leads_payment_status on leads(payment_status) where payment_status is not null;
create index if not exists idx_leads_dnc on leads(do_not_contact) where do_not_contact;
create index if not exists idx_lead_events_conversation on lead_events(conversation_id) where conversation_id is not null;
create index if not exists idx_messages_direction_created on messages(direction, created_at desc);
create index if not exists idx_work_queue_lead_type on work_queue(lead_id, queue_type);
create index if not exists idx_lead_tasks_lead_status on lead_tasks(lead_id, task_status);
create index if not exists idx_integration_logs_source_created on integration_logs(source, created_at desc);
create index if not exists idx_ai_decisions_lead_created on ai_decisions(lead_id, created_at desc);
