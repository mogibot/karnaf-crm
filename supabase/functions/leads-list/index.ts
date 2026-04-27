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
  const status = url.searchParams.get('status');
  const heat = url.searchParams.get('heat');
  const ownershipMode = url.searchParams.get('ownershipMode');
  const search = url.searchParams.get('search');
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);

  const supabase = getServiceSupabase();
  let query = supabase
    .from('leads')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('lead_status', status);
  if (heat) query = query.eq('lead_heat', heat);
  if (ownershipMode) query = query.eq('ownership_mode', ownershipMode);
  if (search) query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error } = await query;

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({
    ok: true,
    leads: data || [],
  });
});
