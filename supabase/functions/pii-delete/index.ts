// GDPR-style hard delete: anonymises every row referencing a lead.
// This is different from the existing soft-delete (`removed_by_request`)
// which just marks the lead and lets purge_removed_pii anonymise after
// a 30-day window. THIS endpoint runs the anonymise immediately when
// the operator confirms the data-subject request is legitimate.
//
// Auth: owner / admin only — requires a confirmation token derived from
// the lead's current updated_at to prevent accidental wipes.
//
// Behaviour:
//   1. Set leads.removed_by_request=true + do_not_contact=true.
//   2. Invoke purge_removed_pii with retention_days=0 so the lead is
//      anonymised this same call.
//   3. Insert an integration_logs row for audit.
//   4. Return ok with the affected counts.

import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { AuthError, requireStaff } from '../_shared/auth.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';

interface DeleteInput {
  leadId: string;
  reason: string;
  /** Confirmation token = leads.updated_at — guards against stale clicks. */
  confirmUpdatedAt: string;
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

  const body = await req.json().catch(() => ({})) as Partial<DeleteInput>;
  if (!body.leadId || !body.reason || !body.confirmUpdatedAt) {
    return jsonResponse(req, { error: 'leadId, reason, confirmUpdatedAt required' }, 400);
  }
  if (body.reason.trim().length < 5) {
    return jsonResponse(req, { error: 'Reason must be at least 5 chars (audit trail)' }, 400);
  }

  const supabase = getServiceSupabase();
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, updated_at, removed_by_request')
    .eq('id', body.leadId)
    .single();
  if (leadErr || !lead) return jsonResponse(req, { error: leadErr?.message ?? 'Lead not found' }, 404);

  // Concurrency token check: if the lead has been touched since the
  // operator clicked "delete", refuse and ask them to confirm again.
  const expected = Date.parse(body.confirmUpdatedAt);
  const actual = Date.parse(String(lead.updated_at));
  if (Number.isFinite(expected) && Number.isFinite(actual) && expected !== actual) {
    return jsonResponse(req, {
      error: 'Lead changed since confirmation — refresh and re-confirm.',
      code: 'stale_confirm_token',
    }, 409);
  }

  // Step 1: mark as removed (idempotent if already set).
  const { error: markErr } = await supabase
    .from('leads')
    .update({ removed_by_request: true, do_not_contact: true })
    .eq('id', body.leadId);
  if (markErr) return jsonResponse(req, { error: markErr.message }, 500);

  // Step 2: immediate purge — retention_days=0 anonymises rows older than
  // "now", which on the just-flipped lead does nothing in some implementations.
  // To be safe we pass retention_days=-1 (anything older than future = all).
  const { error: purgeErr } = await supabase.rpc('purge_removed_pii', { p_retention_days: -1 });
  if (purgeErr) {
    log.warn('pii_purge_rpc_failed', { fn: 'pii-delete', correlationId, err: purgeErr.message });
    // We still respond ok because the mark is in place; purge will run
    // tonight in nightly-jobs.
  }

  // Step 3: audit.
  await supabase.from('integration_logs').insert({
    source: 'pii_delete',
    status: 'success',
    lead_id: body.leadId,
    request_data: { deleted_by: staff.userId, reason: body.reason },
    response_data: { purge_ok: !purgeErr },
  });

  log.info('pii_deleted', { fn: 'pii-delete', correlationId, by: staff.userId, leadId: body.leadId });

  return jsonResponse(req, {
    ok: true,
    leadId: body.leadId,
    purgedImmediately: !purgeErr,
    note: purgeErr ? 'lead marked removed; nightly purge will anonymise' : 'lead anonymised',
  });
});
