import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { AuthError, requireStaff } from '../_shared/auth.ts';

// PostgREST `or` interprets several characters syntactically (`,` separates
// filters, `()` group, `*` is the ilike wildcard, `%` is its alias, `:` is a
// type cast prefix, and `\` is an escape). Anything that could break out of
// the ilike value into a sibling filter has to go before the search string
// reaches the query builder.
function escapeForOr(input: string): string {
  return input
    .replace(/[(),%*:\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'GET') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  try { await requireStaff(req); } catch (err) {
    if (err instanceof AuthError) return jsonResponse(req, { error: err.message }, err.status);
    throw err;
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const heat = url.searchParams.get('heat');
  const ownershipMode = url.searchParams.get('ownershipMode');
  const source = url.searchParams.get('source');
  const fromIso = url.searchParams.get('from');
  const toIso = url.searchParams.get('to');
  const search = url.searchParams.get('search');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));

  // Allowed sort columns — whitelist so a malformed `sortBy=...` can't
  // tunnel into PostgREST. `updated_at desc` stays as the default.
  const SORTABLE_COLUMNS = new Set([
    'updated_at', 'created_at', 'lead_score', 'lead_status', 'lead_heat',
    'last_inbound_at', 'last_outbound_at', 'last_message_at', 'full_name',
  ]);
  const sortByRaw = url.searchParams.get('sortBy') ?? 'updated_at';
  const sortBy = SORTABLE_COLUMNS.has(sortByRaw) ? sortByRaw : 'updated_at';
  const sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

  const supabase = getServiceSupabase();
  let query = supabase
    .from('leads')
    .select('id, full_name, phone, email, source, lead_status, lead_heat, ownership_mode, lead_score, payment_status, last_message_at, last_inbound_at, last_outbound_at, do_not_contact, removed_by_request, updated_at, created_at', { count: 'exact' })
    .order(sortBy, { ascending: sortDir === 'asc', nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('lead_status', status);
  if (heat) query = query.eq('lead_heat', heat);
  if (ownershipMode) query = query.eq('ownership_mode', ownershipMode);
  if (source) query = query.eq('source', source);
  // Date range — `from`/`to` are ISO timestamps. Filter on created_at so
  // analytics drill-down ("cohort week → these leads") lands the right set.
  if (fromIso && Number.isFinite(Date.parse(fromIso))) {
    query = query.gte('created_at', new Date(Date.parse(fromIso)).toISOString());
  }
  if (toIso && Number.isFinite(Date.parse(toIso))) {
    query = query.lte('created_at', new Date(Date.parse(toIso)).toISOString());
  }
  if (search) {
    const safe = escapeForOr(search);
    if (safe) query = query.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) return jsonResponse(req, { error: error.message }, 500);

  return jsonResponse(req, { ok: true, leads: data ?? [], total: count ?? null, limit, offset });
});
