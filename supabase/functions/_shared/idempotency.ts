import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function messageAlreadyLogged(
  supabase: SupabaseClient,
  providerMessageId: string | null,
): Promise<boolean> {
  if (!providerMessageId) return false;

  const { data, error } = await supabase
    .from('messages')
    .select('id')
    .eq('provider_message_id', providerMessageId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}
