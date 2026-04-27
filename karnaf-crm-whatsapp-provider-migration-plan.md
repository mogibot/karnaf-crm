# Karnaf CRM Core - WhatsApp Provider Migration and Connection Plan

## Purpose
This document defines how to approach the WhatsApp transport layer for Karnaf CRM Core while minimizing risk and avoiding lock-in to CRM OLD.

The strategy is to preserve useful provider connectivity while moving all real intelligence and CRM control into the new system.

---

# 1. Goal

The goal is not merely to send and receive WhatsApp messages.
The goal is to establish a reliable, production-grade WhatsApp runtime that is fully controlled by Karnaf CRM Core.

That means the new system must own:
- message intake
- transcript logging
- lead resolution
- AI/human ownership
- queue triggers
- delivery state handling
- template handling
- suppression logic

---

# 2. Strategic decision

## Preserve the transport, replace the brain
Based on CRM OLD review, the transport layer likely already has reusable value.

Therefore:
- reuse or adapt provider connection patterns where safe
- do not reuse old bot behavior as the controlling logic
- move all conversation intelligence into Karnaf CRM Core

---

# 3. Possible provider states

The old system suggests at least two possibilities:
- Meta WhatsApp Cloud API
- WATI fallback/legacy path

The new system should support a connector abstraction that can operate with one provider at a time cleanly.

---

# 4. Preferred target state

## Preferred production target
- one dedicated WhatsApp number for Karnaf CRM
- one provider path chosen as primary
- one webhook destination controlled by the new system
- one runtime layer governing all behavior

## Preferred provider direction
If the current Meta connection is stable and usable, prefer direct Meta Cloud API over unnecessary middle layers.
If WATI is already deeply tied to the number and stable for now, it may be used temporarily, but the business logic should still live in Karnaf CRM Core.

---

# 5. Migration philosophy

Do not migrate by copying the old bot into the new system.
Migrate by extracting:
- webhook verification patterns
- send-message adapter patterns
- provider payload normalization patterns
- template handling patterns

Then reassemble them under the new orchestration architecture.

---

# 6. Required technical layers

## 6.1 Provider connector
Responsibilities:
- verify inbound webhook
- normalize inbound payloads
- send outbound freeform messages
- send outbound template messages
- consume delivery/read/failure status callbacks

## 6.2 Conversation runtime
Responsibilities:
- resolve lead
- append transcript
- enforce ownership state
- call AI orchestrator when appropriate
- queue Mia handoff when appropriate
- write events and next actions

## 6.3 Message policy layer
Responsibilities:
- decide if send is allowed
- determine whether freeform or template is required
- enforce DNC/remove rules
- block forbidden messages

---

# 7. Transition stages

## Stage 1 - Audit current provider setup
Confirm:
- which provider is truly active
- where webhook points now
- whether Meta token is valid
- whether WATI token is active
- whether templates exist
- whether the number is bound to one path or multiple

## Stage 2 - Build provider adapter in new system
- recreate clean send/receive adapter
- add provider-specific normalization
- test with staging/sandbox if possible

## Stage 3 - Connect runtime without switching live traffic yet
- test inbound simulation
- test outbound send
- test delivery status persistence
- test DNC and failure handling

## Stage 4 - Controlled cutover
- update webhook target to new system
- monitor first inbound traffic
- validate transcript logging
- validate Mia visibility

## Stage 5 - Decommission old bot ownership
- disable old AI reply layer
- keep only emergency fallback if needed briefly
- ensure no dual responders remain

---

# 8. Risks to avoid

## 8.1 Dual responders
The same number must not actively be answered by both old and new logic.

## 8.2 Hidden old automations
Any existing auto-reply or routing in the old system must be identified before cutover.

## 8.3 Template blind spot
If the provider requires templates outside session rules, the new system must know template availability before live use.

## 8.4 Missing delivery-state visibility
Without status callbacks, Mia may think messages were sent when they failed.

---

# 9. Migration readiness checklist

Before cutover, confirm:
- provider chosen
- webhook URL known
- verification token set
- send-message tested
- inbound normalization tested
- lead resolution tested
- transcript persistence tested
- Mia queue visibility tested
- suppress/remove handling tested
- status callback handling tested if supported

---

# 10. Recommended implementation stance

The new system should define a provider interface such as:
- receiveInbound(payload)
- sendText(to, text)
- sendTemplate(to, templateName, params)
- handleStatusCallback(payload)
- normalizePhone(raw)

This keeps business logic independent of provider implementation.

---

# 11. When to keep WATI temporarily

Temporary WATI usage may be acceptable if:
- the number is already production-bound there
- migration to direct Meta would slow down the project materially
- the connector is wrapped cleanly and does not control logic

But even then:
## WATI should be treated as transport only, not as the CRM brain.

---

# 12. Long-term ideal

Long-term, the cleanest architecture is:
- Karnaf CRM Core owns runtime behavior
- provider only handles transport
- CRM decides all intelligence, routing, handoff, and state

---

# 13. Final recommendation

The right move is not to rebuild the current bot.
The right move is to extract provider connectivity, then reconnect it under the new Karnaf CRM Core runtime.

That gives speed without inheriting the old brain.
