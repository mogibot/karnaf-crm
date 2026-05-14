import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { AiDecisionContext, AiDecisionOutput } from './ai-contract.ts';
import { buildAiSystemPrompt, buildAiUserPrompt, matchObjections } from './ai-prompt.ts';
import { selectPlaybook } from './playbooks.ts';
import { validateAiDecision } from './ai-validation.ts';
import { isOpen, recordFailure, recordSuccess } from './circuit-breaker.ts';
import { pickPromptVariant, type PromptVariant } from './prompt-variant.ts';
import { AiProviderError, getAiProvider, getProviderFallbackChain, type AiProvider } from './ai-provider.ts';
import { log } from './logger.ts';

export interface DecisionResult {
  output: AiDecisionOutput;
  executionStatus: string;
  rawOutput: unknown;
  promptVersion: string;
  /** PK of the ai_decisions row this call inserted. Null when the
   *  insert failed (we still want the orchestrator to ship the reply). */
  decisionId: string | null;
}

export async function runAiDecision(
  supabase: SupabaseClient,
  context: AiDecisionContext,
  correlationId: string,
): Promise<DecisionResult> {
  // P4.3 — Walk a fallback chain. We pick the first non-tripped provider
  // (primary first), and if its call fails AND opens its breaker, we move
  // on to the next configured provider. If all open, we surface
  // circuit_open exactly like the single-provider path used to.
  const primary = getAiProvider();
  const chain = getProviderFallbackChain(primary);
  const modelLabel = primary.isConfigured() ? primary.modelName() : 'disabled';

  const lastInbound = context.recentMessages.filter((m) => m.senderType === 'lead').slice(-1)[0]?.contentText ?? '';
  const hoursSinceInbound = context.lead.lastInboundAt
    ? (Date.now() - Date.parse(context.lead.lastInboundAt)) / (1000 * 60 * 60)
    : null;

  const playbook = selectPlaybook({
    inboundText: lastInbound,
    leadStatus: context.lead.status,
    source: context.lead.source,
    paymentStatus: context.lead.paymentStatus,
    hoursSinceLastInbound: hoursSinceInbound,
    freeAdviceCount: context.freeAdviceCount,
  });

  // A/B variant: weighted random pick from active rows for this playbook.
  // Falls back to the static prompt_version configured in crm_config.
  let variant: PromptVariant | null = null;
  try {
    variant = await pickPromptVariant(supabase, playbook.name);
  } catch (err) {
    log.warn('variant_lookup_failed', { fn: 'runAiDecision', correlationId, err: String(err) });
  }
  const promptVersion = variant?.version ?? context.runtimeConfig.ai.promptVersion;
  const overrides = variant?.prompt_overrides ?? {};

  const validateInput = {
    currentStatus: context.lead.status,
    forbiddenClaims: context.runtimeConfig.forbiddenClaims,
    playbook,
    maxReplyChars: context.runtimeConfig.ai.maxReplyChars,
    isDoNotContact: context.lead.doNotContact,
    isRemovedByRequest: context.lead.removedByRequest,
    priceRedirectMessage: context.runtimeConfig.product.priceRedirectMessage ?? null,
  } as const;

  const blockWith = async (status: string, raw: unknown): Promise<DecisionResult> => {
    const validated = validateAiDecision({ output: emptyOutput(playbook.name), ...validateInput });
    const decisionId = await logDecision(
      supabase, context, validated.output, status, raw, correlationId, promptVersion, modelLabel,
    );
    return { output: validated.output, executionStatus: status, rawOutput: raw, promptVersion, decisionId };
  };

  if (!primary.isConfigured()) {
    return blockWith('model_disabled', null);
  }

  const breakerCfg = { threshold: 3, cooldownMs: 5 * 60 * 1000 };

  // Try providers in order. We stop at the first success. A provider that
  // is currently open in the breaker is skipped (cheap — no network call).
  const matchedObjections = matchObjections(context.availableObjections, lastInbound, playbook.name);
  const systemPrompt = buildAiSystemPrompt(playbook, context, overrides, matchedObjections);
  const userPrompt = buildAiUserPrompt(context);
  let lastError: { status: string; detail: unknown } | null = null;

  for (let i = 0; i < chain.length; i++) {
    const p: AiProvider = chain[i]!;
    const breakerKey = `ai:${p.name}`;
    if (isOpen(breakerKey, breakerCfg)) {
      log.warn('ai_circuit_open', { fn: 'runAiDecision', correlationId, leadId: context.lead.id, provider: p.name });
      lastError = { status: `${p.name}:circuit_open`, detail: null };
      continue;
    }
    try {
      const { content, model } = await p.generateJson({
        systemPrompt, userPrompt, temperature: 0.4,
      });
      let parsed: Partial<AiDecisionOutput>;
      try {
        parsed = JSON.parse(content) as Partial<AiDecisionOutput>;
      } catch {
        recordFailure(breakerKey, breakerCfg);
        lastError = { status: `${p.name}_parse_error`, detail: content.slice(0, 400) };
        continue;
      }
      const merged: AiDecisionOutput = {
        ...emptyOutput(playbook.name),
        ...parsed,
        sendMode: parsed.sendMode ?? 'freeform',
        policyFlags: Array.isArray(parsed.policyFlags) ? parsed.policyFlags : [],
        playbookName: playbook.name,
      };
      const validated = validateAiDecision({ output: merged, ...validateInput });
      recordSuccess(breakerKey);
      const replyDropped = !!parsed.replyText && !validated.output.replyText;
      const status = replyDropped ? 'validation_blocked' : `${p.name}_success`;
      if (validated.flags.length && !replyDropped) {
        log.warn('ai_validation_warnings', {
          fn: 'runAiDecision', correlationId, leadId: context.lead.id,
          provider: p.name, flags: validated.flags,
        });
      }
      if (i > 0) {
        log.info('ai_provider_failover', {
          fn: 'runAiDecision', correlationId, leadId: context.lead.id,
          chainIndex: i, providerUsed: p.name, primary: primary.name,
        });
      }
      const decisionId = await logDecision(
        supabase, context, validated.output, status, parsed, correlationId, promptVersion, model,
      );
      return { output: validated.output, executionStatus: status, rawOutput: parsed, promptVersion, decisionId };
    } catch (err) {
      recordFailure(breakerKey, breakerCfg);
      if (err instanceof AiProviderError) {
        lastError = { status: err.status, detail: err.detail };
      } else {
        lastError = { status: `${p.name}_exception`, detail: String(err).slice(0, 400) };
      }
      // Move on to the next provider in the chain.
    }
  }

  // All providers in the chain either errored or had open breakers.
  return blockWith(lastError?.status ?? 'circuit_open', lastError?.detail ?? null);
}

function emptyOutput(playbookName: string): AiDecisionOutput {
  return {
    replyText: null,
    intentClassification: 'unclassified',
    leadStatusUpdate: null,
    leadHeatUpdate: null,
    scoreDelta: 0,
    escalateToMia: false,
    escalateToPhoneSales: false,
    createQueueType: null,
    nextActionType: null,
    nextActionDueAt: null,
    notesForMia: null,
    sendMode: 'no_send',
    policyFlags: [],
    playbookName,
  };
}

const NON_ERROR_STATUSES = new Set(['validation_blocked', 'circuit_open', 'model_disabled']);

async function logDecision(
  supabase: SupabaseClient,
  context: AiDecisionContext,
  output: AiDecisionOutput,
  executionStatus: string,
  rawOutput: unknown,
  correlationId: string,
  promptVersion: string,
  modelName: string,
): Promise<string | null> {
  const isError = !executionStatus.endsWith('_success') && !NON_ERROR_STATUSES.has(executionStatus);
  try {
    const { data, error } = await supabase.from('ai_decisions').insert({
      lead_id: context.lead.id,
      model_name: modelName,
      prompt_version: promptVersion,
      playbook_name: output.playbookName,
      input_context_json: { ...context, correlationId },
      raw_output_json: rawOutput ?? {},
      validated_output_json: output,
      execution_status: executionStatus,
      error_message: isError ? executionStatus : null,
    }).select('id').single();
    if (error) {
      log.error('ai_decisions_insert_failed', { fn: 'logDecision', correlationId, err: error.message });
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    log.error('ai_decisions_insert_exception', { fn: 'logDecision', correlationId, err: String(err) });
    return null;
  }
}
