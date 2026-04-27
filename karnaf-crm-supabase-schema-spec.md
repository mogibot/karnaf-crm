# Karnaf CRM Core - Supabase Schema Implementation Spec

## Purpose
This document defines the recommended Supabase data model for Karnaf CRM Core.
It is derived from the product and operational requirements, not from CRM OLD.

The schema should support:
- lead intake
- conversations
- messages
- ownership
- AI orchestration
- queues
- follow-up actions
- payment state
- auditability
- analytics

---

# 1. Design principles

## 1.1 Source of truth
Supabase is the operational source of truth for the CRM runtime.

## 1.2 Event-friendly design
The schema should support event logging and auditability.

## 1.3 State explicitness
Important state must be stored explicitly, not inferred only from message history.

## 1.4 Minimal denormalization where useful
Some summary fields should be stored on leads for speed and operational clarity.

---

# 2. Core tables

## 2.1 leads
Primary entity for every inbound person/inquiry.

Recommended fields:
- id (uuid, pk)
- created_at (timestamptz)
- updated_at (timestamptz)
- full_name (text)
- phone (text, indexed)
- email (text, indexed)
- source (text)
- source_detail (text)
- source_campaign (text)
- webinar_name (text)
- lead_magnet_name (text)
- intake_channel (text)
- external_source (text)
- external_id (text)
- city (text)
- lead_status (text)
- lead_heat (text)
- lead_fit (text)
- readiness_level (text)
- decision_context (text)
- partner_involved (boolean)
- partner_alignment_state (text)
- requested_phone_call (boolean)
- do_not_contact (boolean)
- removed_by_request (boolean)
- human_owner_id (uuid, nullable)
- ownership_mode (text)
- ai_owner_state (text)
- lead_score (integer)
- main_blocker (text)
- pain_point_summary (text)
- goal_summary (text)
- conversation_summary (text)
- last_message_at (timestamptz)
- last_inbound_at (timestamptz)
- last_outbound_at (timestamptz)
- last_human_touch_at (timestamptz)
- last_ai_touch_at (timestamptz)
- next_action_type (text)
- next_action_due_at (timestamptz)
- last_checkout_link_sent_at (timestamptz)
- checkout_state (text)
- payment_status (text)
- payment_reference (text)
- payment_completed_at (timestamptz)
- won_at (timestamptz)
- lost_at (timestamptz)
- lost_reason (text)
- notes_internal (text)
- raw_import_snapshot (jsonb)

Indexes:
- phone unique partial when not null if possible
- email index
- lead_status index
- next_action_due_at index
- do_not_contact index
- payment_status index

---

## 2.2 conversations
Represents a channel thread for a lead.

Fields:
- id (uuid, pk)
- lead_id (uuid, fk -> leads)
- channel (text)  // whatsapp, instagram, email, etc.
- channel_thread_id (text)
- ownership_mode (text)
- current_handler_id (uuid, nullable)
- is_open (boolean)
- started_at (timestamptz)
- last_activity_at (timestamptz)
- last_inbound_at (timestamptz)
- last_outbound_at (timestamptz)
- last_summary (text)
- provider_name (text)
- provider_thread_ref (text)
- metadata_json (jsonb)

Indexes:
- lead_id + channel
- last_activity_at

---

## 2.3 messages
Stores full transcript messages.

Fields:
- id (uuid, pk)
- conversation_id (uuid, fk -> conversations)
- lead_id (uuid, fk -> leads)
- provider_message_id (text)
- sender_type (text) // lead, ai, mia, sales_rep, system
- sender_name (text)
- direction (text) // inbound, outbound, internal
- message_type (text) // text, media, template, system_event
- content_text (text)
- media_url (text)
- media_type (text)
- provider_status (text) // queued, sent, delivered, read, failed
- provider_error (text)
- sent_at (timestamptz)
- delivered_at (timestamptz)
- read_at (timestamptz)
- created_at (timestamptz)
- ai_intent_classification (text)
- ai_sentiment_signal (text)
- requires_review (boolean)
- raw_payload (jsonb)

Indexes:
- conversation_id + created_at
- lead_id + created_at
- provider_message_id unique where possible

---

## 2.4 lead_events
Audit/event log for all meaningful state changes.

Fields:
- id (uuid, pk)
- lead_id (uuid, fk -> leads)
- conversation_id (uuid, nullable)
- event_type (text)
- actor_type (text) // ai, mia, system, provider, owner, sales_rep
- actor_id (uuid, nullable)
- event_payload (jsonb)
- created_at (timestamptz)

Indexes:
- lead_id + created_at
- event_type

---

## 2.5 work_queue
Operational queue entries for Mia / human workflows.

Fields:
- id (uuid, pk)
- lead_id (uuid, fk -> leads)
- queue_type (text)
- priority_level (integer)
- status (text) // pending, claimed, resolved, canceled
- reason (text)
- queue_summary (text)
- assigned_to_user_id (uuid, nullable)
- created_by_actor_type (text)
- due_at (timestamptz)
- created_at (timestamptz)
- resolved_at (timestamptz)
- resolution_note (text)
- payload_json (jsonb)

Indexes:
- status + due_at
- queue_type + status
- assigned_to_user_id

---

## 2.6 lead_tasks
Explicit next actions and scheduled follow-ups.

Fields:
- id (uuid, pk)
- lead_id (uuid, fk -> leads)
- conversation_id (uuid, nullable)
- task_type (text)
- task_status (text) // open, done, canceled, expired
- owner_type (text) // ai, mia, sales_rep, system
- owner_user_id (uuid, nullable)
- title (text)
- description (text)
- priority_level (integer)
- due_at (timestamptz)
- created_at (timestamptz)
- completed_at (timestamptz)
- completion_note (text)
- payload_json (jsonb)

Indexes:
- lead_id + task_status
- due_at + task_status

---

## 2.7 payment_events
Tracks checkout/payment signals.

Fields:
- id (uuid, pk)
- lead_id (uuid, fk -> leads)
- external_order_id (text)
- external_customer_ref (text)
- payment_provider (text)
- product_code (text)
- payment_status (text)
- amount (numeric)
- currency (text)
- payload_json (jsonb)
- created_at (timestamptz)

Indexes:
- external_order_id
- lead_id
- payment_status

---

## 2.8 integration_logs
Technical logs for webhook and provider behavior.

Fields:
- id (uuid, pk)
- source (text)
- status (text)
- lead_id (uuid, nullable)
- request_data (jsonb)
- response_data (jsonb)
- error_message (text)
- created_at (timestamptz)

Indexes:
- source + created_at
- status + created_at

---

## 2.9 bot_runs / ai_decisions
Recommended for AI observability.

Fields:
- id (uuid, pk)
- lead_id (uuid, fk -> leads)
- conversation_id (uuid, nullable)
- model_name (text)
- prompt_version (text)
- playbook_name (text)
- input_context_json (jsonb)
- raw_output_json (jsonb)
- validated_output_json (jsonb)
- execution_status (text)
- error_message (text)
- created_at (timestamptz)

Why:
- enables debugging
- supports QA
- helps compare model quality over time

---

## 2.10 crm_config
Operational config table for runtime behavior.

Fields:
- id (uuid, pk)
- config_key (text unique)
- config_value (jsonb)
- updated_at (timestamptz)
- updated_by_user_id (uuid, nullable)

Examples:
- active_hours
- first_response_rules
- escalation_thresholds
- template_names
- payment_product_mapping

---

# 3. Supporting tables

## 3.1 tags
Optional normalized tag definitions.

## 3.2 lead_tags
Join table for leads and tags.

## 3.3 users / profiles
If using Supabase auth, create profile rows for Mia, admin, etc.

## 3.4 provider_connections
Optional table for storing metadata about WhatsApp/payment/source providers, excluding raw secrets.

---

# 4. Enums or controlled text values

Use either SQL enums or strict text constraints for:
- lead_status
- lead_heat
- lead_fit
- readiness_level
- ownership_mode
- payment_status
- queue_type
- task_status
- sender_type
- direction
- message_type

Recommended approach:
- use Postgres enums for highly stable values
- use controlled text + app validation where flexibility is needed

---

# 5. Recommended lead status values

- new
- first_contact_sent
- responded
- qualified
- nurture
- checkout_pushed
- payment_pending
- human_handoff
- won
- lost
- dormant
- onboarding_active
- active_student
- do_not_contact
- removed_by_request
- duplicate
- manual_review_required

---

# 6. Recommended ownership values

- ai_active
- mia_active
- phone_sales_pending
- shared_watch
- suppressed

---

# 7. Recommended queue types

- first_response_due
- hot_lead
- sla_risk
- human_handoff
- payment_pending
- phone_escalation
- nurture_due
- dormant_review
- failed_automation
- weekend_carryover
- low_fit_cleanup

---

# 8. Row-level security guidance

## Principle
Sensitive operational data should not be client-writable without policy.

## Recommended model
- user-facing app uses authenticated users
- most write actions happen through controlled RPC/functions or server routes
- service-role usage restricted to backend functions only

## Mia role
Should be able to:
- view relevant leads
- view transcripts
- add notes
- send human messages through approved paths
- resolve queues

---

# 9. Triggers and automation recommendations

Suggested DB triggers or backend-managed updates for:
- `updated_at` maintenance
- updating `last_message_at` and last inbound/outbound timestamps
- syncing conversation last activity
- creating lead_events on important status transitions

Be careful not to bury core business logic inside fragile DB triggers. Use application logic for high-level state decisions.

---

# 10. Analytics readiness fields

Keep enough stored data to later calculate:
- response time
- close rate by source
- qualification rate by source
- checkout completion rate
- time in state
- AI vs Mia intervention impact
- lead aging

This means storing timestamps explicitly matters.

---

# 11. Migration stance

If importing historical data from CRM OLD:
- map old fields into the new schema intentionally
- do not preserve old status semantics blindly
- keep raw imported payloads where useful
- prefer clean transformed imports over schema compromise

---

# 12. Final implementation guidance

The developer should:
1. create the schema from this spec, not copy CRM OLD directly
2. add only the minimum necessary historical compatibility fields
3. keep runtime-critical state explicit
4. design for observability from day one

This schema should support the full Karnaf CRM Core operating model cleanly.
