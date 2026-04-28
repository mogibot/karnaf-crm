// Maintains a rolling structured summary on leads.conversation_summary so
// the model gets long-context awareness without re-feeding the full thread.
//
// Two modes (config_value @ crm_config.summary_runtime.mode):
//   * "heuristic" (default) — pure-Postgres-cheap keyword extraction,
//     identical to the version unit-tested in lib/runtime/transcript-summary.
//   * "model"               — calls the OpenAI chat API for a Hebrew rolling
//                             summary; falls back to heuristic on failure.
//
// Pure helpers are mirrored in lib/runtime/transcript-summary.ts for tests.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { env } from './env.ts';
import { log } from './logger.ts';

const REFRESH_THRESHOLD = 10;
const RECENT_KEPT = 8;
const SUMMARY_MAX_CHARS = 1200;

interface SummariseRow {
  sender_type: string | null;
  direction: string | null;
  content_text: string | null;
  created_at: string | null;
}

interface SummaryRuntimeConfig {
  mode: 'heuristic' | 'model';
  minMessages: number;
  modelTemperature: number;
  maxOutputChars: number;
}

const DEFAULT_RUNTIME: SummaryRuntimeConfig = {
  mode: 'heuristic', minMessages: REFRESH_THRESHOLD, modelTemperature: 0.2, maxOutputChars: SUMMARY_MAX_CHARS,
};

async function loadRuntime(supabase: SupabaseClient): Promise<SummaryRuntimeConfig> {
  const { data } = await supabase
    .from('crm_config')
    .select('config_value')
    .eq('config_key', 'summary_runtime')
    .maybeSingle();
  const value = (data?.config_value as Partial<SummaryRuntimeConfig> | undefined) ?? {};
  return {
    mode: value.mode === 'model' ? 'model' : 'heuristic',
    minMessages: typeof value.minMessages === 'number' ? value.minMessages : DEFAULT_RUNTIME.minMessages,
    modelTemperature: typeof value.modelTemperature === 'number' ? value.modelTemperature : DEFAULT_RUNTIME.modelTemperature,
    maxOutputChars: typeof value.maxOutputChars === 'number' ? value.maxOutputChars : DEFAULT_RUNTIME.maxOutputChars,
  };
}

export async function maybeRefreshSummary(
  supabase: SupabaseClient,
  leadId: string,
  conversationId: string,
  correlationId = 'noop',
): Promise<void> {
  const runtime = await loadRuntime(supabase);
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if (!count || count < runtime.minMessages) return;

  const { data: olderRows } = await supabase
    .from('messages')
    .select('sender_type, direction, content_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(Math.max(0, count - RECENT_KEPT));

  if (!olderRows || olderRows.length === 0) return;

  const heuristicSummary = synthesise(olderRows as SummariseRow[], runtime.maxOutputChars);
  let summary = heuristicSummary;

  if (runtime.mode === 'model' && env.openaiApiKey()) {
    const modelSummary = await summariseWithModel(olderRows as SummariseRow[], runtime, correlationId);
    if (modelSummary) summary = modelSummary.slice(0, runtime.maxOutputChars);
  }

  await supabase.from('leads').update({ conversation_summary: summary }).eq('id', leadId);
}

async function summariseWithModel(
  rows: SummariseRow[],
  runtime: SummaryRuntimeConfig,
  correlationId: string,
): Promise<string | null> {
  const transcript = rows
    .map((r) => `${r.sender_type ?? 'unknown'}: ${(r.content_text ?? '').replace(/\s+/g, ' ').trim()}`)
    .filter((line) => line.trim().length > 0)
    .join('\n');
  if (!transcript) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openaiApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.openaiModel(),
        temperature: runtime.modelTemperature,
        messages: [
          {
            role: 'system',
            content: [
              'אתה כותב סיכום שיחה תמציתי לליד CRM שמוכר תוכנית דיגיטלית בעברית.',
              'הפק 3-6 משפטים קצרים שמכסים: מה הליד מחפש, מה ידוע על מצבו, מה החסם או הצורך, ופעולה מומלצת.',
              'כתוב בעברית מקצועית. בלי הבטחות. בלי ציטוטים מילוליים.',
            ].join(' '),
          },
          { role: 'user', content: transcript },
        ],
      }),
    });
    if (!res.ok) {
      log.warn('summary_model_http_error', { fn: 'summariseWithModel', correlationId, status: res.status });
      return null;
    }
    const json = await res.json();
    const text = (json.choices?.[0]?.message?.content as string | undefined)?.trim() ?? '';
    return text || null;
  } catch (err) {
    log.warn('summary_model_exception', { fn: 'summariseWithModel', correlationId, err: String(err) });
    return null;
  }
}

function synthesise(rows: SummariseRow[], maxChars = SUMMARY_MAX_CHARS): string {
  const buckets: Record<'lead' | 'ai' | 'human' | 'system', string[]> = {
    lead: [], ai: [], human: [], system: [],
  };
  for (const r of rows) {
    const text = (r.content_text || '').trim();
    if (!text) continue;
    if (r.sender_type === 'lead') buckets.lead.push(text);
    else if (r.sender_type === 'ai') buckets.ai.push(text);
    else if (r.sender_type === 'mia' || r.sender_type === 'sales_rep' || r.sender_type === 'admin') buckets.human.push(text);
    else buckets.system.push(text);
  }

  const sections: string[] = [];
  if (buckets.lead.length) sections.push('LEAD: ' + condense(buckets.lead));
  if (buckets.ai.length) sections.push('AI: ' + condense(buckets.ai));
  if (buckets.human.length) sections.push('HUMAN: ' + condense(buckets.human));
  return sections.join('\n').slice(0, maxChars);
}

function condense(items: string[]): string {
  const picks: string[] = [];
  for (let i = 0; i < items.length; i += 4) {
    const item = items[i];
    if (item) picks.push(firstSentence(item));
  }
  for (const tail of items.slice(-2)) picks.push(firstSentence(tail));
  return Array.from(new Set(picks)).join(' | ');
}

function firstSentence(s: string): string {
  const m = s.match(/.{1,180}?(?:[.!?\n]|$)/);
  return (m ? m[0] : s).trim();
}
