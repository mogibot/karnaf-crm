import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { normalizeIsraeliPhone } from '../_shared/phone.ts';
import { normalizeProviderInbound } from '../_shared/whatsapp-provider.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge ?? '', { status: 200, headers: corsHeaders });
    }

    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const body = await req.json();
  const normalized = normalizeProviderInbound(body);

  if (!normalized) {
    return jsonResponse({ ok: true, skipped: true, reason: 'Unsupported payload' });
  }

  const phone = normalizeIsraeliPhone(normalized.phone) || normalized.phone;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: existingLead } = await supabase
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  let leadId = existingLead?.id as string | undefined;

  if (!leadId) {
    const { data: createdLead, error } = await supabase
      .from('leads')
      .insert({
        phone,
        full_name: normalized.senderName || 'ליד מוואטסאפ',
        source: 'whatsapp',
        intake_channel: 'whatsapp',
        lead_status: 'new',
        lead_heat: 'cool',
        ownership_mode: 'ai_active',
      })
      .select('id')
      .single();

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    leadId = createdLead.id as string;
  }

  const { data: existingConversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('lead_id', leadId)
    .eq('channel', 'whatsapp')
    .maybeSingle();

  let conversationId = existingConversation?.id as string | undefined;

  if (!conversationId) {
    const { data: createdConversation, error } = await supabase
      .from('conversations')
      .insert({
        lead_id: leadId,
        channel: 'whatsapp',
        provider_name: normalized.provider,
        ownership_mode: 'ai_active',
      })
      .select('id')
      .single();

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    conversationId = createdConversation.id as string;
  }

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    lead_id: leadId,
    provider_message_id: normalized.providerMessageId,
    sender_type: 'lead',
    sender_name: normalized.senderName,
    direction: 'inbound',
    message_type: normalized.messageType,
    content_text: normalized.text,
    media_type: normalized.mediaType || null,
    created_at: normalized.receivedAt,
    raw_payload: normalized.rawPayload,
  });

  await supabase.from('lead_events').insert({
    lead_id: leadId,
    conversation_id: conversationId,
    event_type: 'inbound_message_received',
    actor_type: 'provider',
    event_payload: {
      provider: normalized.provider,
      provider_message_id: normalized.providerMessageId,
    },
  });

  await supabase.from('leads').update({
    last_message_at: normalized.receivedAt,
    last_inbound_at: normalized.receivedAt,
    updated_at: new Date().toISOString(),
  }).eq('id', leadId);

  const orchestrateRes = await fetch(`${SUPABASE_URL}/functions/v1/orchestrate-message`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      leadId,
      conversationId,
      provider: normalized.provider,
      providerMessageId: normalized.providerMessageId,
    }),
  });

  const orchestrateJson = await orchestrateRes.json().catch(() => null);

  return jsonResponse({
    ok: true,
    leadId,
    conversationId,
    orchestrator: orchestrateJson,
  });
});
