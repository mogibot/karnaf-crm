# Karnaf CRM Core - V1 Engineering Backlog

## Purpose
This backlog translates the architecture and roadmap into concrete engineering work buckets.
It is not a sprint tool yet, but it should give the developer a practical build queue.

---

# 1. Epic - Project foundation

## Tasks
- create canonical repo structure
- create docs folder and reference links
- configure package/workspace structure if needed
- define app conventions and shared type strategy
- set up linting/formatting/build basics

---

# 2. Epic - Supabase foundation

## Tasks
- create initial schema migrations
- create lead-related enums/constraints
- create RLS/auth strategy
- create seed/config baseline
- create typed DB client layer

---

# 3. Epic - Lead runtime model

## Tasks
- implement lead repository/services
- implement lead create/update/upsert flows
- implement lead status transition rules
- implement ownership mode rules
- implement next-action scheduling behavior
- implement event emission on state changes

---

# 4. Epic - Conversation and transcript model

## Tasks
- implement conversations table access layer
- implement messages persistence layer
- implement provider message deduplication
- implement transcript summary update mechanism
- implement inbound/outbound timestamps updates

---

# 5. Epic - WhatsApp provider adapter

## Tasks
- implement provider interface
- implement Meta/WATI adapter strategy
- implement inbound webhook verification
- implement inbound payload normalization
- implement outbound text sending
- implement outbound template sending
- implement delivery/read/failure callback handling
- implement retry/error handling

---

# 6. Epic - AI orchestration core

## Tasks
- implement context builder
- implement structured model output schema
- implement model call wrapper
- implement policy validator for AI output
- implement conversation intent classification
- implement lead score update logic
- implement escalation recommendation logic
- implement suppression/DNC logic

---

# 7. Epic - Playbooks and policy layer

## Tasks
- implement first-response playbooks by source
- implement qualification playbooks
- implement objection playbooks
- implement free-advice boundary logic
- implement payment-pending rescue logic
- implement handoff playbooks
- implement dormant reactivation logic

---

# 8. Epic - Mia operational layer

## Tasks
- implement work queue services
- implement queue claim/resolve behavior
- implement human handoff package generation
- implement ownership transfer actions
- implement Mia note-taking and internal action logging
- implement return-to-AI behavior

---

# 9. Epic - Dashboard and operator console

## Tasks
- implement dashboard KPI cards
- implement leads workspace
- implement lead detail page
- implement transcript timeline view
- implement queue center
- implement system health panel
- implement filters/search/sorting

---

# 10. Epic - Alerts and SLA

## Tasks
- implement first-response SLA timers
- implement 8h/10h/12h warning logic
- implement hot lead alerts
- implement weekend carryover queueing
- implement payment pending alerts
- implement failed automation alerts

---

# 11. Epic - Payment lifecycle

## Tasks
- implement payment webhook receiver
- implement payment event persistence
- implement lead-to-payment matching logic
- implement won transition logic
- implement onboarding task creation
- implement payment ambiguity manual review flow

---

# 12. Epic - Admin/configuration

## Tasks
- implement config table readers/writers
- implement runtime settings surface if needed
- implement provider status visibility
- implement active-hours and threshold config handling

---

# 13. Epic - Analytics and QA

## Tasks
- implement source performance queries
- implement conversion funnel queries
- implement objection frequency aggregation
- implement AI decision audit views
- implement queue resolution analytics
- implement Mia vs AI outcome comparisons

---

# 14. Epic - Production hardening

## Tasks
- implement structured logging
- implement error reporting surfaces
- implement retry policies
- implement webhook idempotency protection
- implement deployment checklist
- implement rollback notes

---

# 15. Recommended initial build sequence

Do these first:
1. schema
2. lead runtime
3. message runtime
4. provider adapter
5. AI orchestration core
6. queue + Mia actions
7. dashboard and lead detail
8. alerts
9. payment lifecycle
10. analytics

---

# 16. Definition of done for V1

V1 is done when:
- a lead enters from a real source
- it appears in Supabase correctly
- a WhatsApp conversation can start
- messages are logged
- AI can respond under policy
- Mia can take over from the UI
- SLA risk is visible
- a payment can move the lead to won
- the whole system is operable from one main console

---

# 17. Final note

The backlog should be refined into developer tickets, but the build order should remain disciplined.
Do not jump to polished visuals before the runtime machine is alive.
