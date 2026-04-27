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
  const queueType = url.searchParams.get('queueType');
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 300);

  const supabase = getServiceSupabase();
  let query = supabase
    .from('work_queue')
    .select('*')
    .order('priority_level', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (queueType) query = query.eq('queue_type', queueType);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({
    ok: true,
    queueItems: data || [],
  });
});
