# Karnaf CRM Core - Implementation Status

## What exists now
The repository now contains:
- full product and operations specification
- WhatsApp runtime architecture spec
- master implementation blueprint
- CRM OLD salvage audit
- build roadmap
- Supabase schema spec
- environment/secrets/deploy map
- WhatsApp provider migration plan
- V1 engineering backlog
- developer handoff brief

## Initial implementation skeleton added
- root TypeScript project scaffold (`package.json`, `tsconfig.json`, `.gitignore`)
- placeholder app structure under `apps/web`
- shared CRM types in `lib/types/crm.ts`
- lead state-machine skeleton in `lib/runtime/state-machine.ts`
- WhatsApp provider adapter interface in `lib/runtime/provider-interface.ts`
- orchestrator decision contract in `lib/runtime/orchestrator-contract.ts`
- Supabase folder scaffold
- initial schema migration skeleton in `supabase/migrations/001_initial_schema.sql`
- function layout placeholders in `supabase/functions/README.md`

## Runtime scaffolds added
- shared CORS helper in `supabase/functions/_shared/cors.ts`
- phone normalization helpers in `supabase/functions/_shared/phone.ts`
- provider message types in `supabase/functions/_shared/provider-types.ts`
- initial provider transport implementation in `supabase/functions/_shared/whatsapp-provider.ts`
- inbound webhook scaffold in `supabase/functions/whatsapp-webhook/index.ts`
- placeholder orchestration runtime in `supabase/functions/orchestrate-message/index.ts`
- payment ingestion scaffold in `supabase/functions/payment-webhook/index.ts`

## Runtime service layer added
- Supabase service client helper in `supabase/functions/_shared/supabase.ts`
- lead/conversation/event/timestamp helpers in `supabase/functions/_shared/lead-service.ts`
- queue helper in `supabase/functions/_shared/queue-service.ts`
- structured placeholder decision helper in `supabase/functions/_shared/placeholder-brain.ts`
- config loader in `supabase/functions/_shared/config-service.ts`
- follow-up task helper in `supabase/functions/_shared/task-service.ts`
- basic message idempotency helper in `supabase/functions/_shared/idempotency.ts`
- webhook/orchestrator now use shared service helpers instead of embedding all logic inline
- provider status callback scaffold in `supabase/functions/provider-status-webhook/index.ts`
- admin/operator action scaffold in `supabase/functions/admin-actions/index.ts`
- dashboard data scaffold in `supabase/functions/dashboard-summary/index.ts`
- lead detail data scaffold in `supabase/functions/lead-detail/index.ts`
- shared operator-side view-model helpers in `lib/view-models/*`

## What is still missing
This is still not a production-ready application.
The following still need implementation:
- real frontend app
- full Supabase migrations validated against auth/users needs
- real AI model invocation and structured decision engine
- richer queue resolution / Mia action services
- full handoff package generation and return-to-AI controls
- RLS policies
- deployment wiring and env setup
- richer payment matching and onboarding flows
- deeper idempotency and retry discipline for tasks/queues/webhooks
- auth protection around operator/admin action functions
- richer dashboard aggregation and filtering

## Recommended next coding targets
1. finalize schema migration and auth/profile model
2. replace placeholder brain with structured AI runtime
3. add auth protection and deeper idempotency around webhook/task/action creation
4. implement actual web dashboard/leads/detail views on top of the new data endpoints
5. add richer queue/handoff services and Mia action functions
6. add configuration-backed runtime rules and admin config surfaces
