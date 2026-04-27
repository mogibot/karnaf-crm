# Karnaf CRM Core - Developer Handoff Brief

## Purpose
This brief is the fast orientation document for the developer.
Read this first, then move into the full spec pack.

---

# 1. What this project is

Karnaf CRM Core is the new primary CRM and WhatsApp sales operating system for selling the digital program:
## "הדרך לדירה"

This is not a redesign pass on CRM OLD.
This is a clean new primary system.

CRM OLD exists only as a donor for selected infrastructure such as:
- WhatsApp/provider wiring
- webhook patterns
- Supabase patterns
- selected UI references

Do not let CRM OLD dictate the architecture of the new system.

---

# 2. The business goal

The system should:
- capture leads from forms/webinars/WhatsApp/Instagram/manual sources
- respond fast
- operate primarily through WhatsApp
- qualify intelligently
- update CRM state automatically
- surface Mia intervention at the right moments
- avoid losing leads
- support payment completion and won-state transitions
- run from one main console

The north star is:
## no lead left behind + strong conversion discipline

---

# 3. What not to do

Do not:
- rebuild the old bot logic
- start from decorative UI before runtime works
- create multiple competing sources of truth
- mix old status logic into the new schema without intent
- hardcode fragile business assumptions from CRM OLD
- build a chat bot without CRM-aware orchestration

---

# 4. What to build first

Build in this order:
1. Supabase schema
2. lead runtime
3. WhatsApp transport adapter
4. transcript persistence
5. AI orchestration core
6. Mia queue and ownership controls
7. lead detail + dashboard skeleton
8. SLA and alerts
9. payment state handling
10. analytics and hardening

---

# 5. Critical architectural principles

## One system only
Karnaf CRM Core is the single future system of record.

## Supabase is the runtime truth
Leads, conversations, queues, events, and payment state should live there.

## WhatsApp is a channel, not the brain
Transport may reuse old patterns.
All intelligence must live in the new runtime.

## Mia must operate from one console
She should not need fragmented tools.

## AI output must be structured
The model must return not only message text, but also state/action decisions.

---

# 6. Immediate build targets for V1

V1 must include:
- real lead intake
- real WhatsApp inbound/outbound
- real message logging
- real lead state updates
- real Mia handoff
- real queue visibility
- real SLA awareness
- real payment completion handling

V1 does not need over-polished analytics or decorative complexity.

---

# 7. Most important source docs

Read these in roughly this order:
1. `karnaf-crm-full-spec.md`
2. `karnaf-crm-master-implementation-blueprint.md`
3. `karnaf-crm-old-salvage-audit.md`
4. `karnaf-crm-supabase-schema-spec.md`
5. `karnaf-crm-whatsapp-provider-migration-plan.md`
6. `karnaf-crm-build-roadmap.md`
7. `karnaf-crm-v1-engineering-backlog.md`
8. `karnaf-crm-env-secrets-deploy-map.md`

---

# 8. Product truth you must preserve

The main product is one program:
## הדרך לדירה

Do not architect the first version as a multi-product sales machine.
Other inquiry types can be classified, but must not confuse the core flow.

Phone calls are escalation, not default.
WhatsApp-first flow is the default.

---

# 9. Practical recommendation

If a decision is unclear, prefer:
- clarity over cleverness
- runtime correctness over visual polish
- explicit state over inferred magic
- one strong path over many half-built paths

---

# 10. Final orientation

This project should become a serious operator console and CRM brain, not just a prettier chatbot.

If the runtime machine is correct, the rest can be layered well.
If the runtime machine is weak, no UI polish will save it.
