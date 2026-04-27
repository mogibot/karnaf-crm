import type { AiDecisionOutput } from './ai-contract.ts';

const allowedStatuses = new Set([
  'new',
  'first_contact_sent',
  'responded',
  'qualified',
  'nurture',
  'checkout_pushed',
  'payment_pending',
  'human_handoff',
  'won',
  'lost',
  'dormant',
  'onboarding_active',
  'active_student',
  'do_not_contact',
  'removed_by_request',
  'duplicate',
  'manual_review_required',
]);

const allowedHeats = new Set(['hot', 'warm', 'cool', 'cold']);
const allowedSendModes = new Set(['freeform', 'template', 'manual_only', 'no_send']);
const allowedQueues = new Set([
  'first_response_due',
  'hot_lead',
  'sla_risk',
  'human_handoff',
  'payment_pending',
  'phone_escalation',
  'nurture_due',
  'dormant_review',
  'failed_automation',
  'weekend_carryover',
  'low_fit_cleanup',
]);

export function validateAiDecision(output: AiDecisionOutput): AiDecisionOutput {
  return {
    ...output,
    leadStatusUpdate: output.leadStatusUpdate && allowedStatuses.has(output.leadStatusUpdate)
      ? output.leadStatusUpdate
      : null,
    leadHeatUpdate: output.leadHeatUpdate && allowedHeats.has(output.leadHeatUpdate)
      ? output.leadHeatUpdate
      : null,
    scoreDelta: Number.isFinite(output.scoreDelta) ? Math.max(-25, Math.min(25, output.scoreDelta)) : 0,
    createQueueType: output.createQueueType && allowedQueues.has(output.createQueueType)
      ? output.createQueueType
      : null,
    sendMode: allowedSendModes.has(output.sendMode) ? output.sendMode : 'no_send',
    replyText: sanitizeReplyText(output.replyText),
  };
}

function sanitizeReplyText(replyText: string | null): string | null {
  if (!replyText) return null;
  const trimmed = replyText.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('"replyText"')) {
    return null;
  }
  return trimmed.slice(0, 1200);
}
