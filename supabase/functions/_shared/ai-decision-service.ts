import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { AiDecisionContext, AiDecisionOutput } from './ai-contract.ts';
import { buildAiSystemPrompt, buildAiUserPrompt } from './ai-prompt.ts';
import { decidePlaceholderReply } from './placeholder-brain.ts';
import { validateAiDecision } from './ai-validation.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';

export async function runAiDecision(
  supabase: SupabaseClient,
  context: AiDecisionContext,
): Promise<AiDecisionOutput> {
  const placeholder = decidePlaceholderReply({
    inboundText: context.recentMessages.filter((m) => m.senderType === 'lead').at(-1)?.contentText || '',
    fullName: context.lead.fullName,
    source: context.lead.source,
    currentStatus: context.lead.status,
    currentHeat: context.lead.heat,
  });

  const placeholderOutput: AiDecisionOutput = {
    replyText: placeholder.replyText,
    intentClassification: 'placeholder_runtime',
    leadStatusUpdate: placeholder.leadStatusUpdate,
    leadHeatUpdate: placeholder.leadHeatUpdate,
    scoreDelta: placeholder.scoreDelta,
    escalateToMia: placeholder.escalateToMia,
    escalateToPhoneSales: placeholder.escalateToPhoneSales,
    createQueueType: placeholder.createQueueType,
    nextActionType: placeholder.escalateToMia ? 'human_follow_up' : 'follow_up',
    nextActionDueAt: null,
    notesForMia: placeholder.notesForMia,
    sendMode: placeholder.replyText ? 'freeform' : 'no_send',
  };

  if (!OPENAI_API_KEY) {
    const validated = validateAiDecision(placeholderOutput);
    await logAiDecision(supabase, context, validated, 'placeholder_no_openai_key');
    return validated;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildAiSystemPrompt() },
          { role: 'user', content: buildAiUserPrompt(context) },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const validated = validateAiDecision(placeholderOutput);
      await logAiDecision(supabase, context, validated, `openai_error:${response.status}:${errorText.slice(0, 200)}`);
      return validated;
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      const validated = validateAiDecision(placeholderOutput);
      await logAiDecision(supabase, context, validated, 'openai_empty_content');
      return validated;
    }

    const parsed = JSON.parse(content) as Partial<AiDecisionOutput>;
    const merged: AiDecisionOutput = {
      ...placeholderOutput,
      ...parsed,
      sendMode: parsed.sendMode || placeholderOutput.sendMode,
    };

    const validated = validateAiDecision(merged);
    await logAiDecision(supabase, context, validated, 'openai_success');
    return validated;
  } catch (error) {
    const validated = validateAiDecision(placeholderOutput);
    await logAiDecision(supabase, context, validated, `openai_exception:${String(error)}`);
    return validated;
  }
}

async function logAiDecision(
  supabase: SupabaseClient,
  context: AiDecisionContext,
  output: AiDecisionOutput,
  executionStatus: string,
) {
  await supabase.from('ai_decisions').insert({
    lead_id: context.lead.id,
    model_name: OPENAI_API_KEY ? OPENAI_MODEL : 'placeholder',
    prompt_version: 'v0-scaffold',
    playbook_name: 'general_runtime',
    input_context_json: context,
    raw_output_json: output,
    validated_output_json: output,
    execution_status: executionStatus,
  });
}
