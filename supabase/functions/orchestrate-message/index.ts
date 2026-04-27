import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { sendWhatsAppText } from '../_shared/whatsapp-provider.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const { leadId, conversationId } = await req.json();
  if (!leadId || !conversationId) {
    return jsonResponse({ error: 'Missing leadId or conversationId' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (leadError || !lead) {
    return jsonResponse({ error: leadError?.message || 'Lead not found' }, 404);
  }

  const { data: recentMessages, error: messagesError } = await supabase
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(8);

  if (messagesError) {
    return jsonResponse({ error: messagesError.message }, 500);
  }

  const lastInbound = recentMessages?.find((m) => m.sender_type === 'lead');
  const inboundText = lastInbound?.content_text || '';

  const replyText = decidePlaceholderReply({
    inboundText,
    fullName: lead.full_name,
    source: lead.source,
  });

  const sendResult = replyText && !lead.do_not_contact && !lead.removed_by_request
    ? await sendWhatsAppText(lead.phone, replyText)
    : { ok: false, error: 'Suppressed or no reply' };

  if (replyText && sendResult.ok) {
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      lead_id: leadId,
      provider_message_id: sendResult.providerMessageId || null,
      sender_type: 'ai',
      direction: 'outbound',
      message_type: 'text',
      content_text: replyText,
      provider_status: 'sent',
    });

    await supabase.from('lead_events').insert({
      lead_id: leadId,
      conversation_id: conversationId,
      event_type: 'ai_reply_sent',
      actor_type: 'ai',
      event_payload: {
        reply_text: replyText,
      },
    });

    await supabase.from('leads').update({
      lead_status: lead.lead_status === 'new' ? 'first_contact_sent' : lead.lead_status,
      last_message_at: new Date().toISOString(),
      last_outbound_at: new Date().toISOString(),
      last_ai_touch_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', leadId);
  }

  return jsonResponse({
    ok: true,
    replyText,
    sendResult,
    note: 'Placeholder orchestration only. Replace with structured AI runtime next.',
  });
});

function decidePlaceholderReply(input: {
  inboundText: string;
  fullName: string | null;
  source: string;
}): string | null {
  const text = input.inboundText.trim();
  if (!text) return 'היי, קיבלתי את ההודעה שלך. אעבור איתך מסודר כדי להבין איך הכי נכון לעזור.';

  const lower = text.toLowerCase();
  const namePrefix = input.fullName ? `${input.fullName}, ` : '';

  if (lower.includes('לא מעוניין') || lower.includes('תסיר') || lower.includes('להסיר')) {
    return `${namePrefix}הבנתי, עוצר כאן ולא אמשיך לפנות.`;
  }

  if (lower.includes('מחיר') || lower.includes('כמה עולה')) {
    return `${namePrefix}בשמחה. לפני שאני זורק לך תשובה יבשה, חשוב לי להבין אם את/ה בכיוון של דירה ראשונה או השקעה ראשונה, כדי לכוון נכון.`;
  }

  return `${namePrefix}מעולה, קיבלתי. כדי לכוון אותך נכון, מה בעיקר מעניין אותך עכשיו סביב רכישת הדירה?`;
}
