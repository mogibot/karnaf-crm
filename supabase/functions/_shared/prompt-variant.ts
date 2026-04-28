// Pulls a weighted prompt variant for the active playbook from the
// `prompt_variants` table. The `prompt_overrides` jsonb supports two
// keys today:
//   - "objective": replaces the playbook objective in the system prompt
//   - "guidance":  string[] that replaces the playbook guidance bullets
// Future fields are forwarded verbatim into the prompt builder so we can
// extend the schema without a code release.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface PromptVariant {
  version: string;
  weight: number;
  prompt_overrides: PromptOverrides;
}

export interface PromptOverrides {
  objective?: string;
  guidance?: string[];
  [key: string]: unknown;
}

export async function pickPromptVariant(
  supabase: SupabaseClient,
  playbookName: string,
): Promise<PromptVariant | null> {
  const { data, error } = await supabase.rpc('pick_prompt_variant', { p_playbook: playbookName });
  if (error || !data) return null;
  if (Array.isArray(data) && data.length > 0) return data[0] as PromptVariant;
  if (!Array.isArray(data) && typeof data === 'object') return data as PromptVariant;
  return null;
}
