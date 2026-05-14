// Prompt variant management.
//
// Admin (owner/admin) actions:
//   * GET /                    list variants
//   * POST action=create       create new variant
//   * POST action=update       update existing variant
//   * POST action=delete       hard delete
//   * POST action=review_request   accept/decline a mia-submitted request
//
// Manager (mia) actions:
//   * GET /                    list variants (read-only stats)
//   * POST action=request_change   open a change-request (no direct mutation)
//   * POST action=list_requests    list pending change-requests
//
// All read-only paths flow through here so the page can stop redirecting
// mia to home (the audit's "nav lies to mia" finding). Direct mutation
// still requires admin.

import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { AuthError, requireStaff } from '../_shared/auth.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';

const KNOWN_PLAYBOOKS = new Set([
  'first_contact_whatsapp_inbound', 'first_contact_form_lead', 'qualification',
  'price_objection', 'free_advice_boundary', 'checkout_push',
  'payment_pending_rescue', 'phone_request', 'opt_out',
]);

const KNOWN_REQUEST_KINDS = new Set([
  'tweak_objective', 'tweak_guidance', 'change_weight',
  'activate', 'deactivate', 'create_new', 'remove',
]);

interface CreateInput {
  action: 'create';
  playbook_name: string;
  version: string;
  weight: number;
  prompt_overrides?: Record<string, unknown>;
  is_active?: boolean;
  notes?: string | null;
}
interface UpdateInput {
  action: 'update';
  id: string;
  weight?: number;
  prompt_overrides?: Record<string, unknown>;
  is_active?: boolean;
  notes?: string | null;
}
interface DeleteInput {
  action: 'delete';
  id: string;
}
interface RequestChangeInput {
  action: 'request_change';
  variant_id?: string | null;
  playbook_name: string;
  request_kind: string;
  rationale: string;
  proposed_change?: Record<string, unknown>;
}
interface ListRequestsInput {
  action: 'list_requests';
  status?: 'pending' | 'accepted' | 'declined' | 'superseded';
}
interface ReviewRequestInput {
  action: 'review_request';
  request_id: string;
  decision: 'accept' | 'decline';
  reviewer_note?: string | null;
}
type Payload =
  | CreateInput | UpdateInput | DeleteInput
  | RequestChangeInput | ListRequestsInput | ReviewRequestInput;

const ADMIN_ROLES = ['owner', 'admin'] as const;
const STAFF_ROLES = ['owner', 'admin', 'mia'] as const;

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
    // GET + the two manager actions are staff-scoped (mia included).
    // Admin-only actions re-check below before mutating.
    staff = await requireStaff(req, { allow: [...STAFF_ROLES] });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(req, { error: err.message }, err.status);
    throw err;
  }

  const supabase = getServiceSupabase();
  const isAdmin = ADMIN_ROLES.includes(staff.role as typeof ADMIN_ROLES[number]);

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('prompt_variants')
      .select('id, playbook_name, version, weight, prompt_overrides, is_active, notes, created_at, updated_at')
      .order('playbook_name')
      .order('version');
    if (error) return jsonResponse(req, { error: error.message }, 500);
    return jsonResponse(req, { ok: true, variants: data ?? [] });
  }

  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as Payload;

  // ── Admin-only actions ──────────────────────────────────────────────────
  if (body.action === 'create' || body.action === 'update' || body.action === 'delete') {
    if (!isAdmin) return jsonResponse(req, { error: 'Admin only' }, 403);
  }

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
      created_by_user_id: staff.userId,
    };
    const { data, error } = await supabase
      .from('prompt_variants')
      .insert(insert)
      .select('id, playbook_name, version, weight, prompt_overrides, is_active, notes, created_at, updated_at')
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
    if (Object.keys(updates).length === 0) {
      return jsonResponse(req, { error: 'No fields to update' }, 400);
    }
    const { data, error } = await supabase
      .from('prompt_variants')
      .update(updates)
      .eq('id', body.id)
      .select('id, playbook_name, version, weight, prompt_overrides, is_active, notes, created_at, updated_at')
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

  // ── Change-request flow (mia + admin) ──────────────────────────────────
  if (body.action === 'request_change') {
    if (!body.playbook_name || !body.request_kind || !body.rationale) {
      return jsonResponse(req, { error: 'Missing playbook_name, request_kind, or rationale' }, 400);
    }
    if (!KNOWN_PLAYBOOKS.has(body.playbook_name)) {
      return jsonResponse(req, { error: `Unknown playbook ${body.playbook_name}` }, 400);
    }
    if (!KNOWN_REQUEST_KINDS.has(body.request_kind)) {
      return jsonResponse(req, { error: `Unknown request_kind ${body.request_kind}` }, 400);
    }
    const rationale = body.rationale.trim().slice(0, 4000);
    if (!rationale) {
      return jsonResponse(req, { error: 'Rationale is required' }, 400);
    }
    const { data, error } = await supabase
      .from('prompt_variant_change_requests')
      .insert({
        variant_id: body.variant_id ?? null,
        playbook_name: body.playbook_name,
        request_kind: body.request_kind,
        rationale,
        proposed_change: body.proposed_change ?? {},
        requested_by: staff.userId,
      })
      .select('id, variant_id, playbook_name, request_kind, rationale, proposed_change, status, requested_by, requested_at')
      .single();
    if (error) return jsonResponse(req, { error: error.message }, 500);
    log.info('pvcr_created', { fn: 'prompt-variants', correlationId, by: staff.userId, id: data.id });
    return jsonResponse(req, { ok: true, request: data });
  }

  if (body.action === 'list_requests') {
    const statusFilter = body.status ?? 'pending';
    const { data, error } = await supabase
      .from('prompt_variant_change_requests')
      .select('id, variant_id, playbook_name, request_kind, rationale, proposed_change, status, requested_by, requested_at, reviewed_by, reviewed_at, reviewer_note')
      .eq('status', statusFilter)
      .order('requested_at', { ascending: false })
      .limit(200);
    if (error) return jsonResponse(req, { error: error.message }, 500);
    return jsonResponse(req, { ok: true, requests: data ?? [] });
  }

  if (body.action === 'review_request') {
    if (!isAdmin) return jsonResponse(req, { error: 'Admin only' }, 403);
    if (!body.request_id || !body.decision) {
      return jsonResponse(req, { error: 'Missing request_id or decision' }, 400);
    }
    if (body.decision !== 'accept' && body.decision !== 'decline') {
      return jsonResponse(req, { error: 'decision must be accept or decline' }, 400);
    }
    const status = body.decision === 'accept' ? 'accepted' : 'declined';
    const { data, error } = await supabase
      .from('prompt_variant_change_requests')
      .update({
        status,
        reviewed_by: staff.userId,
        reviewed_at: new Date().toISOString(),
        reviewer_note: body.reviewer_note ?? null,
      })
      .eq('id', body.request_id)
      .select('id, status, reviewed_by, reviewed_at, reviewer_note')
      .single();
    if (error) return jsonResponse(req, { error: error.message }, 500);
    log.info('pvcr_reviewed', { fn: 'prompt-variants', correlationId, by: staff.userId, id: body.request_id, decision: body.decision });
    return jsonResponse(req, { ok: true, request: data });
  }

  return jsonResponse(req, { error: 'Unsupported action' }, 400);
});
