import { getServiceSupabase } from '../_shared/supabase.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const payload = await req.json();
  const supabase = getServiceSupabase();

  const providerMessageId = payload.message_id || payload.id || payload.statuses?.[0]?.id || null;
  const status = payload.status || payload.statuses?.[0]?.status || 'unknown';
  const errorMessage = payload.error?.message || payload.errors?.[0]?.message || null;
  const timestamp = new Date().toISOString();

  if (!providerMessageId) {
    await supabase.from('integration_logs').insert({
      source: 'provider_status_webhook',
      status: 'ignored',
      request_data: payload,
      response_data: { reason: 'missing_provider_message_id' },
    });

    return jsonResponse({ ok: true, ignored: true });
  }

  const { data: message } = await supabase
    .from('messages')
    .select('id, lead_id, conversation_id')
    .eq('provider_message_id', providerMessageId)
    .maybeSingle();

  if (message) {
    const updates: Record<string, unknown> = {
      provider_status: status,
    };

    if (status === 'delivered') updates.delivered_at = timestamp;
    if (status === 'read') updates.read_at = timestamp;
    if (status === 'failed') updates.provider_error = errorMessage;

    await supabase.from('messages').update(updates).eq('id', message.id);

    await supabase.from('lead_events').insert({
      lead_id: message.lead_id,
      conversation_id: message.conversation_id,
      event_type: 'provider_message_status_updated',
      actor_type: 'provider',
      event_payload: {
        provider_message_id: providerMessageId,
        status,
        error_message: errorMessage,
      },
    });
  }

  await supabase.from('integration_logs').insert({
    source: 'provider_status_webhook',
    status: 'success',
    lead_id: message?.lead_id || null,
    request_data: payload,
    response_data: {
      provider_message_id: providerMessageId,
      status,
      matched_message: !!message,
    },
  });

  return jsonResponse({ ok: true, matchedMessage: !!message });
});
