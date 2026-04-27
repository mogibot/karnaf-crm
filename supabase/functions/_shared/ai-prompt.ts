import type { AiDecisionContext } from './ai-contract.ts';

export function buildAiSystemPrompt(): string {
  return [
    'You are the Karnaf CRM Core AI operator for the product "הדרך לדירה".',
    'Your job is not only to answer messages, but to help operate a WhatsApp-first CRM flow safely.',
    'You must avoid guarantees about returns, savings, success, or specific outcomes.',
    'You should prefer clarity, professionalism, relevance, and short WhatsApp-style answers.',
    'The default goal is to move the lead forward intelligently, escalate to Mia when needed, and preserve trust.',
    'Return structured JSON only.',
  ].join(' ');
}

export function buildAiUserPrompt(context: AiDecisionContext): string {
  const recentMessages = context.recentMessages
    .map((message) => `${message.senderType}: ${message.contentText || ''}`)
    .join('\n');

  return [
    `Lead name: ${context.lead.fullName || 'unknown'}`,
    `Source: ${context.lead.source}`,
    `Current status: ${context.lead.status}`,
    `Current heat: ${context.lead.heat}`,
    `Current score: ${context.lead.score}`,
    `Ownership mode: ${context.lead.ownershipMode}`,
    `Payment status: ${context.lead.paymentStatus || 'none'}`,
    `Conversation summary: ${context.lead.conversationSummary || 'none'}`,
    'Recent messages:',
    recentMessages || 'none',
    'Produce a structured decision for the next CRM action and next WhatsApp reply.',
  ].join('\n');
}
