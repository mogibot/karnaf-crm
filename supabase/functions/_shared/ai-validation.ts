import type { AiDecisionOutput, SendMode } from './ai-contract.ts';
import { canTransition } from './state-machine.ts';
import { containsForbiddenClaim } from './forbidden-claims.ts';
import type { Playbook } from './playbooks.ts';

const ALLOWED_STATUSES = new Set([
  'new', 'first_contact_sent', 'responded', 'qualified', 'nurture',
  'checkout_pushed', 'payment_pending', 'human_handoff', 'won', 'lost',
  'dormant', 'onboarding_active', 'active_student', 'do_not_contact',
  'removed_by_request', 'duplicate', 'manual_review_required',
]);

const ALLOWED_HEATS = new Set(['hot', 'warm', 'cool', 'cold']);
const ALLOWED_SEND_MODES = new Set<SendMode>(['freeform', 'template', 'manual_only', 'no_send']);
const ALLOWED_QUEUES = new Set([
  'first_response_due', 'hot_lead', 'sla_risk', 'human_handoff',
  'payment_pending', 'phone_escalation', 'nurture_due', 'dormant_review',
  'failed_automation', 'weekend_carryover', 'low_fit_cleanup',
  'manual_review_required',
]);

export interface ValidationInput {
  output: AiDecisionOutput;
  currentStatus: string;
  forbiddenClaims: string[];
  playbook: Playbook;
  maxReplyChars: number;
  isDoNotContact: boolean;
  isRemovedByRequest: boolean;
}

export interface ValidationResult {
  output: AiDecisionOutput;
  flags: string[];
}

export function validateAiDecision(input: ValidationInput): ValidationResult {
  const flags: string[] = [];
  const out: AiDecisionOutput = { ...input.output };

  // Hard suppression: never auto-send to opted-out leads.
  if (input.isDoNotContact || input.isRemovedByRequest) {
    out.replyText = null;
    out.sendMode = 'no_send';
    flags.push('suppressed_dnc');
  }

  // Status transition validity (against state-machine + playbook allowance).
  if (out.leadStatusUpdate) {
    if (!ALLOWED_STATUSES.has(out.leadStatusUpdate)) {
      flags.push('status_not_allowed_value');
      out.leadStatusUpdate = null;
    } else if (!canTransition(input.currentStatus, out.leadStatusUpdate)) {
      flags.push('status_transition_illegal');
      out.leadStatusUpdate = null;
    } else if (!input.playbook.allowedNextStatuses.includes(out.leadStatusUpdate)) {
      flags.push('status_outside_playbook');
      out.leadStatusUpdate = null;
    }
  }

  // Heat validity.
  if (out.leadHeatUpdate && !ALLOWED_HEATS.has(out.leadHeatUpdate)) {
    flags.push('heat_invalid');
    out.leadHeatUpdate = null;
  }

  // Score delta clamp.
  out.scoreDelta = Number.isFinite(out.scoreDelta) ? Math.max(-25, Math.min(25, Math.trunc(out.scoreDelta))) : 0;

  // Queue type validity.
  if (out.createQueueType && !ALLOWED_QUEUES.has(out.createQueueType)) {
    flags.push('queue_invalid');
    out.createQueueType = null;
  }

  // Send mode validity.
  if (!ALLOWED_SEND_MODES.has(out.sendMode)) {
    flags.push('send_mode_invalid');
    out.sendMode = 'no_send';
  }

  // Reply text sanitisation.
  out.replyText = sanitizeReply(out.replyText, input.maxReplyChars);

  // Forbidden claim substring check.
  if (out.replyText) {
    const hit = containsForbiddenClaim(out.replyText, input.forbiddenClaims) ||
      containsForbiddenClaim(out.replyText, input.playbook.forbidden);
    if (hit) {
      flags.push(`forbidden_claim:${hit}`);
      out.replyText = null;
      out.sendMode = 'no_send';
    }
  }

  // Escalation consistency: phone escalation must produce a phone queue.
  if (out.escalateToPhoneSales) {
    out.createQueueType = 'phone_escalation';
    if (!out.notesForMia) out.notesForMia = 'Phone escalation requested.';
  } else if (out.escalateToMia && !out.createQueueType) {
    out.createQueueType = 'human_handoff';
  }

  // No reply text + freeform send_mode is contradictory.
  if (!out.replyText && (out.sendMode === 'freeform' || out.sendMode === 'template')) {
    out.sendMode = 'no_send';
    flags.push('no_send_no_text');
  }

  // Track the playbook used for auditability.
  out.policyFlags = Array.from(new Set([...(out.policyFlags || []), ...flags]));
  out.playbookName = input.playbook.name;

  return { output: out, flags };
}

function sanitizeReply(reply: string | null, maxChars: number): string | null {
  if (!reply) return null;
  let trimmed = reply.trim();
  if (!trimmed) return null;
  // Reject obvious JSON echoes from a poorly-tuned model.
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('"replyText"')) return null;
  if (trimmed.length > maxChars) trimmed = trimmed.slice(0, maxChars);
  return trimmed;
}
