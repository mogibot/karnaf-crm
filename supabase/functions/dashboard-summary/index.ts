import { getServiceSupabase } from '../_shared/supabase.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabase = getServiceSupabase();

  const [leadsRes, queueRes] = await Promise.all([
    supabase.from('leads').select('id, lead_status, lead_heat, payment_status, created_at'),
    supabase.from('work_queue').select('id, queue_type, status').eq('status', 'pending'),
  ]);

  if (leadsRes.error) {
    return jsonResponse({ error: leadsRes.error.message }, 500);
  }

  if (queueRes.error) {
    return jsonResponse({ error: queueRes.error.message }, 500);
  }

  const leads = leadsRes.data || [];
  const queueItems = queueRes.data || [];

  const today = new Date().toISOString().slice(0, 10);
  const leadsToday = leads.filter((lead) => String(lead.created_at || '').slice(0, 10) === today).length;
  const unansweredNow = leads.filter((lead) => ['new', 'first_contact_sent'].includes(String(lead.lead_status))).length;
  const hotLeadsNow = leads.filter((lead) => String(lead.lead_heat) === 'hot').length;
  const paymentPendingNow = leads.filter((lead) => ['payment_pending'].includes(String(lead.lead_status)) || String(lead.payment_status) === 'paid').length;

  const queueCounts: Record<string, number> = {};
  for (const item of queueItems) {
    const key = String(item.queue_type || 'unknown');
    queueCounts[key] = (queueCounts[key] || 0) + 1;
  }

  return jsonResponse({
    ok: true,
    summary: {
      leadsToday,
      unansweredNow,
      hotLeadsNow,
      paymentPendingNow,
      slaRiskCount: queueCounts['sla_risk'] || 0,
      queueCounts,
    },
  });
});
