import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { resolveQueueItem } from '../_shared/queue-service.ts';
import { logLeadEvent } from '../_shared/lead-service.ts';
import { AuthError, requireStaff } from '../_shared/auth.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';

interface ResolvePayload {
  queueItemId: string;
  resolutionNote?: string | null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const correlationId = correlationFromRequest(req);
  let staff;
  try {
    staff = await requireStaff(req, { allow: ['owner', 'admin', 'mia', 'sales_rep'] });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(req, { error: err.message }, err.status);
    throw err;
  }

  const body = await req.json().catch(() => ({})) as Partial<ResolvePayload>;
  const { queueItemId, resolutionNote } = body;
  if (!queueItemId) return jsonResponse(req, { error: 'Missing queueItemId' }, 400);

  const supabase = getServiceSupabase();
  const { data: item, error } = await supabase
    .from('work_queue').select('id, lead_id, queue_type, status').eq('id', queueItemId).single();
  if (error || !item) return jsonResponse(req, { error: error?.message ?? 'Queue item not found' }, 404);
  if (item.status !== 'pending' && item.status !== 'claimed') {
    return jsonResponse(req, { error: 'Queue item already resolved' }, 409);
  }

  await resolveQueueItem(supabase, queueItemId, resolutionNote ?? null);
  await logLeadEvent(supabase, item.lead_id, 'queue_resolved', staff.role, {
    queue_item_id: queueItemId, queue_type: item.queue_type, note: resolutionNote ?? null, correlation_id: correlationId,
  }, undefined, staff.userId);

  log.info('queue_resolved', { fn: 'queue-resolve', correlationId, queueItemId, userId: staff.userId });
  return jsonResponse(req, { ok: true });
});
