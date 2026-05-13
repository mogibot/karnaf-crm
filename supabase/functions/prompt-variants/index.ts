// Owner/admin CRUD for the prompt_variants table. Lists, creates, updates,
// and deletes A/B variants. The runtime selector (pick_prompt_variant RPC)
// reads these rows directly so changes here take effect on the next AI
// decision without redeploys.

import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { AuthError, requireStaff } from '../_shared/auth.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';

const KNOWN_PLAYBOOKS = new Set([
  'first_contact_whatsapp_inbound', 'first_contact_form_lead', 'qualification',
  'price_objection', 'free_advice_boundary', 'checkout_push',
  'payment_pending_rescue', 'phone_request', 'opt_out',
]);

interface CreateInput {
  action: 'create';
  playbook_name: string;
  version: string;
  weight: number;
  prompt_overrides?: Record<string, unknown>;
  is_active?: boolean;
  notes?: string | null;
  lead_segment_filter?: SegmentFilter;
}
interface UpdateInput {
  action: 'update';
  id: string;
  weight?: number;
  prompt_overrides?: Record<string, unknown>;
  is_active?: boolean;
  notes?: string | null;
  lead_segment_filter?: SegmentFilter;
}

interface SegmentFilter {
  heat?: string[];
  source?: string[];
  status?: string[];
}

function sanitiseFilter(input: unknown): SegmentFilter | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: SegmentFilter = {};
  const allowedKeys: (keyof SegmentFilter)[] = ['heat', 'source', 'status'];
  const src = input as Record<string, unknown>;
  for (const k of allowedKeys) {
    const v = src[k];
    if (Array.isArray(v)) {
      const cleaned = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (cleaned.length) out[k] = cleaned;
    }
  }
  return out;
}
interface DeleteInput {
  action: 'delete';
  id: string;
}
type Payload = CreateInput | UpdateInput | DeleteInput;

function clampWeight(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(v)));
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const correlationId = correlationFromRequest(req);

  let staff;
  try {
    staff = await requireStaff(req, { allow: ['owner', 'admin'] });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(req, { error: err.message }, err.status);
    throw err;
  }

  const supabase = getServiceSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('prompt_variants')
      .select('id, playbook_name, version, weight, prompt_overrides, is_active, notes, lead_segment_filter, created_at, updated_at')
      .order('playbook_name')
      .order('version');
    if (error) return jsonResponse(req, { error: error.message }, 500);
    return jsonResponse(req, { ok: true, variants: data ?? [] });
  }

  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as Payload;

  if (body.action === 'create') {
    if (!body.playbook_name || !body.version) {
      return jsonResponse(req, { error: 'Missing playbook_name or version' }, 400);
    }
    if (!KNOWN_PLAYBOOKS.has(body.playbook_name)) {
      return jsonResponse(req, { error: `Unknown playbook ${body.playbook_name}` }, 400);
    }
    const insert = {
      playbook_name: body.playbook_name,
      version: body.version,
      weight: clampWeight(body.weight),
      prompt_overrides: body.prompt_overrides ?? {},
      is_active: body.is_active ?? true,
      notes: body.notes ?? null,
      lead_segment_filter: sanitiseFilter(body.lead_segment_filter) ?? {},
      created_by_user_id: staff.userId,
    };
    const { data, error } = await supabase
      .from('prompt_variants')
      .insert(insert)
      .select('id, playbook_name, version, weight, prompt_overrides, is_active, notes, lead_segment_filter, created_at, updated_at')
      .single();
    if (error) {
      if (error.message.includes('duplicate key value')) {
        return jsonResponse(req, { error: 'Variant for this (playbook, version) already exists' }, 409);
      }
      return jsonResponse(req, { error: error.message }, 500);
    }
    log.info('prompt_variant_created', { fn: 'prompt-variants', correlationId, by: staff.userId, id: data.id });
    return jsonResponse(req, { ok: true, variant: data });
  }

  if (body.action === 'update') {
    if (!body.id) return jsonResponse(req, { error: 'Missing id' }, 400);
    const updates: Record<string, unknown> = {};
    if (body.weight !== undefined) updates.weight = clampWeight(body.weight);
    if (body.prompt_overrides !== undefined) updates.prompt_overrides = body.prompt_overrides;
    if (body.is_active !== undefined) updates.is_active = body.is_active;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.lead_segment_filter !== undefined) {
      updates.lead_segment_filter = sanitiseFilter(body.lead_segment_filter) ?? {};
    }
    if (Object.keys(updates).length === 0) {
      return jsonResponse(req, { error: 'No fields to update' }, 400);
    }
    const { data, error } = await supabase
      .from('prompt_variants')
      .update(updates)
      .eq('id', body.id)
      .select('id, playbook_name, version, weight, prompt_overrides, is_active, notes, lead_segment_filter, created_at, updated_at')
      .single();
    if (error) return jsonResponse(req, { error: error.message }, 500);
    log.info('prompt_variant_updated', { fn: 'prompt-variants', correlationId, by: staff.userId, id: body.id });
    return jsonResponse(req, { ok: true, variant: data });
  }

  if (body.action === 'delete') {
    if (!body.id) return jsonResponse(req, { error: 'Missing id' }, 400);
    const { error } = await supabase.from('prompt_variants').delete().eq('id', body.id);
    if (error) return jsonResponse(req, { error: error.message }, 500);
    log.info('prompt_variant_deleted', { fn: 'prompt-variants', correlationId, by: staff.userId, id: body.id });
    return jsonResponse(req, { ok: true });
  }

  return jsonResponse(req, { error: 'Unsupported action' }, 400);
});
