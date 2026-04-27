import { getServiceSupabase } from '../_shared/supabase.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(req.url);
  const leadId = url.searchParams.get('leadId');

  if (!leadId) {
    return jsonResponse({ error: 'Missing leadId' }, 400);
  }

  const supabase = getServiceSupabase();

  const [leadRes, messagesRes, queueRes] = await Promise.all([
    supabase.from('leads').select('*').eq('id', leadId).single(),
    supabase.from('messages').select('*').eq('lead_id', leadId).order('created_at', { ascending: true }).limit(100),
    supabase.from('work_queue').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(20),
  ]);

  if (leadRes.error) {
    return jsonResponse({ error: leadRes.error.message }, 404);
  }

  if (messagesRes.error) {
    return jsonResponse({ error: messagesRes.error.message }, 500);
  }

  if (queueRes.error) {
    return jsonResponse({ error: queueRes.error.message }, 500);
  }

  return jsonResponse({
    ok: true,
    lead: leadRes.data,
    messages: messagesRes.data || [],
    queueItems: queueRes.data || [],
  });
});
