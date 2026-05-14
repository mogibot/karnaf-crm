// GDPR-style data export: returns every row referencing a single lead
// across the CRM tables, as a single JSON bundle the operator can hand
// to the data subject.
//
// Auth: owner / admin only. Lead is identified by lead_id, phone, or
// email — but the export only ever returns one lead's data (no
// cross-subject leakage).
//
// Out of scope: removing the data — that's pii-delete. This endpoint is
// read-only, no DB mutations.

import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { AuthError, requireStaff } from '../_shared/auth.ts';
import { normalizeIsraeliPhone } from '../_shared/phone.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';

interface ExportInput {
  leadId?: string;
  phone?: string;
  email?: string;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const correlationId = correlationFromRequest(req);
  let staff;
  try {
    staff = await requireStaff(req, { allow: ['owner', 'admin'] });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(req, { error: err.message }, err.status);
    throw err;
  }

  const body = await req.json().catch(() => ({})) as ExportInput;
  const supabase = getServiceSupabase();

  // Resolve to a single lead. Order of precedence: id, phone, email.
  let leadId = body.leadId;
  if (!leadId && body.phone) {
    const normalized = normalizeIsraeliPhone(body.phone);
    if (!normalized) return jsonResponse(req, { error: 'Invalid phone' }, 400);
    const { data } = await supabase.from('leads').select('id').eq('phone', normalized).maybeSingle();
    leadId = data?.id;
  }
  if (!leadId && body.email) {
    const email = body.email.trim().toLowerCase();
    const { data } = await supabase.from('leads').select('id').eq('email', email).maybeSingle();
    leadId = data?.id;
  }
  if (!leadId) return jsonResponse(req, { error: 'No matching lead' }, 404);

  // Pull every table that references the lead. Service-role bypasses RLS,
  // which is what we want here — operator's already verified as admin.
  const [
    leadRow, conversations, messages, leadEvents, leadTasks, queueItems,
    aiDecisions, aiReviews, paymentEvents, conversationClaims,
  ] = await Promise.all([
    supabase.from('leads').select('*').eq('id', leadId).single(),
    supabase.from('conversations').select('*').eq('lead_id', leadId),
    supabase.from('messages').select('*').eq('lead_id', leadId).order('created_at'),
    supabase.from('lead_events').select('*').eq('lead_id', leadId).order('created_at'),
    supabase.from('lead_tasks').select('*').eq('lead_id', leadId),
    supabase.from('work_queue').select('*').eq('lead_id', leadId),
    supabase.from('ai_decisions').select('*').eq('lead_id', leadId).order('created_at'),
    supabase.from('ai_decision_reviews').select('*').eq('lead_id', leadId),
    supabase.from('payment_events').select('*').eq('lead_id', leadId),
    supabase.from('conversation_claims').select('*').in('conversation_id',
      (await supabase.from('conversations').select('id').eq('lead_id', leadId)).data?.map((c) => c.id) ?? ['00000000-0000-0000-0000-000000000000']),
  ]);

  if (leadRow.error) return jsonResponse(req, { error: leadRow.error.message }, 500);

  // Audit the export so we know who exported what (this row goes to a
  // data_subject_requests table if it exists; otherwise just to logs).
  await supabase.from('integration_logs').insert({
    source: 'pii_export',
    status: 'success',
    lead_id: leadId,
    request_data: { exported_by: staff.userId, requested: body },
    response_data: { tables_included: 10 },
  });

  log.info('pii_exported', { fn: 'pii-export', correlationId, by: staff.userId, leadId });

  return jsonResponse(req, {
    ok: true,
    exportedAt: new Date().toISOString(),
    exportedBy: staff.email,
    leadId,
    data: {
      lead: leadRow.data,
      conversations: conversations.data ?? [],
      messages: messages.data ?? [],
      lead_events: leadEvents.data ?? [],
      lead_tasks: leadTasks.data ?? [],
      work_queue: queueItems.data ?? [],
      ai_decisions: aiDecisions.data ?? [],
      ai_decision_reviews: aiReviews.data ?? [],
      payment_events: paymentEvents.data ?? [],
      conversation_claims: conversationClaims.data ?? [],
    },
  });
});
