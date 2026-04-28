import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { AuthError, requireStaff } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'GET') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  try { await requireStaff(req); } catch (err) {
    if (err instanceof AuthError) return jsonResponse(req, { error: err.message }, err.status);
    throw err;
  }

  const url = new URL(req.url);
  const queueType = url.searchParams.get('queueType');
  const status = url.searchParams.get('status') ?? 'pending';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 300);

  const supabase = getServiceSupabase();
  let query = supabase
    .from('work_queue')
    .select('*, leads:lead_id(id, full_name, phone, lead_status, lead_heat, ownership_mode)')
    .order('priority_level', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (queueType) query = query.eq('queue_type', queueType);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return jsonResponse(req, { error: error.message }, 500);

  return jsonResponse(req, { ok: true, queueItems: data ?? [] });
});
