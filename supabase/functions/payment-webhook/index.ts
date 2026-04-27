import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { normalizeIsraeliPhone } from '../_shared/phone.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const payload = await req.json();
  const phone = normalizeIsraeliPhone(payload.phone || payload.customer_phone || payload.mobile || null);
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : null;
  const paymentStatus = String(payload.payment_status || payload.status || 'unknown');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let leadQuery = supabase.from('leads').select('id').limit(1);
  if (phone) {
    leadQuery = leadQuery.eq('phone', phone);
  } else if (email) {
    leadQuery = leadQuery.eq('email', email);
  }

  const { data: lead } = await leadQuery.maybeSingle();

  await supabase.from('payment_events').insert({
    lead_id: lead?.id || null,
    external_order_id: payload.order_id || payload.transaction_id || null,
    external_customer_ref: payload.customer_id || null,
    payment_provider: payload.provider || 'unknown',
    product_code: payload.product_code || payload.product || null,
    payment_status: paymentStatus,
    amount: payload.amount || null,
    currency: payload.currency || 'ILS',
    payload_json: payload,
  });

  if (lead?.id && ['paid', 'completed', 'success'].includes(paymentStatus.toLowerCase())) {
    await supabase.from('leads').update({
      payment_status: 'paid',
      payment_reference: payload.order_id || payload.transaction_id || null,
      payment_completed_at: new Date().toISOString(),
      lead_status: 'won',
      won_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', lead.id);

    await supabase.from('lead_events').insert({
      lead_id: lead.id,
      event_type: 'payment_completed',
      actor_type: 'provider',
      event_payload: {
        payment_status: paymentStatus,
        order_id: payload.order_id || payload.transaction_id || null,
      },
    });
  }

  return jsonResponse({ ok: true, matchedLeadId: lead?.id || null });
});
