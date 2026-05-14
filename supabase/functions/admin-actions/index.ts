import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { ensurePendingQueueItem, resolveQueueItem } from '../_shared/queue-service.ts';
import { logLeadEvent, transitionLeadStatus, updateLeadFields } from '../_shared/lead-service.ts';
import { AuthError, requireStaff, type StaffRole } from '../_shared/auth.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';

type ActionName =
  | 'assign_to_mia'
  | 'return_to_ai'
  | 'mark_phone_escalation'
  | 'mark_dnc'
  | 'mark_lost'
  | 'mark_won'
  | 'resolve_queue'
  | 'log_phone_call'
  | 'undo_recent_action';

// Per-action role allowlist. Sales reps can only log their own calls and
// resolve queue items; lifecycle transitions (won/lost/dnc/handoff) and
// ownership re-routing belong to Mia / admins / owners.
const ACTION_ROLES: Record<ActionName, StaffRole[]> = {
  assign_to_mia: ['owner', 'admin', 'mia'],
  return_to_ai: ['owner', 'admin', 'mia'],
  mark_phone_escalation: ['owner', 'admin', 'mia'],
  mark_dnc: ['owner', 'admin', 'mia'],
  mark_lost: ['owner', 'admin', 'mia'],
  mark_won: ['owner', 'admin', 'mia'],
  resolve_queue: ['owner', 'admin', 'mia', 'sales_rep'],
  log_phone_call: ['owner', 'admin', 'mia', 'sales_rep'],
  undo_recent_action: ['owner', 'admin', 'mia'],
};

// Status-changing actions that record `prev_state` in their event_payload
// so undo_recent_action can roll them back.
const UNDOABLE_ACTIONS = new Set<ActionName>([
  'mark_dnc', 'mark_lost', 'mark_won', 'mark_phone_escalation',
  'assign_to_mia', 'return_to_ai',
]);

const UNDO_WINDOW_SECONDS = 600; // 10 minutes — plenty of room for a toast undo + a "wait, what?" double-take.

interface ActionPayload {
  action: ActionName;
  leadId?: string;
  conversationId?: string | null;
  queueItemId?: string;
  note?: string | null;
  callOutcome?: 'connected' | 'no_answer' | 'voicemail' | 'declined' | 'callback_requested';
  callDurationMinutes?: number;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const correlationId = correlationFromRequest(req);

  let staff;
  try {
    // Allow any staff role through the door; per-action gating runs below
    // once we know which action was requested.
    staff = await requireStaff(req, { allow: ['owner', 'admin', 'mia', 'sales_rep'] });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(req, { error: err.message }, err.status);
    throw err;
  }

  const body = await req.json().catch(() => ({})) as ActionPayload;
  const { action, leadId, conversationId, queueItemId, note, callOutcome, callDurationMinutes } = body;

  if (!action) return jsonResponse(req, { error: 'Missing action' }, 400);

  const allowedRoles = ACTION_ROLES[action];
  if (!allowedRoles) return jsonResponse(req, { error: 'Unsupported action' }, 400);
  if (!allowedRoles.includes(staff.role)) {
    return jsonResponse(req, { error: `Role '${staff.role}' not permitted for action '${action}'` }, 403);
  }

  const supabase = getServiceSupabase();

  if (action === 'resolve_queue') {
    if (!queueItemId) return jsonResponse(req, { error: 'Missing queueItemId' }, 400);
    await resolveQueueItem(supabase, queueItemId, note ?? null);
    log.info('admin_action', { fn: 'admin-actions', correlationId, userId: staff.userId, action });
    return jsonResponse(req, { ok: true, action });
  }

  if (!leadId) return jsonResponse(req, { error: 'Missing leadId' }, 400);

  const meta: Record<string, unknown> = { actor_user_id: staff.userId, role: staff.role, note: note ?? null, correlation_id: correlationId };
  const ts = new Date().toISOString();

  // For undoable actions, snapshot the columns we're about to touch so
  // undo_recent_action can roll them back. Reads are cheap; skip for the
  // log_phone_call / resolve_queue paths.
  if (UNDOABLE_ACTIONS.has(action)) {
    const { data: prev } = await supabase
      .from('leads')
      .select('lead_status, ownership_mode, do_not_contact, won_at, lost_at, lost_reason, requested_phone_call, human_owner_id, last_human_touch_at')
      .eq('id', leadId)
      .maybeSingle();
    if (prev) meta.prev_state = prev;
  }

  // ── Undo handler — reverses the most recent undoable action by this
  // user on this lead, if it fired within UNDO_WINDOW_SECONDS.
  if (action === 'undo_recent_action') {
    const cutoff = new Date(Date.now() - UNDO_WINDOW_SECONDS * 1000).toISOString();
    const { data: recent, error: histErr } = await supabase
      .from('lead_events')
      .select('id, event_type, event_payload, created_at')
      .eq('lead_id', leadId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(20);
    if (histErr) return jsonResponse(req, { error: histErr.message }, 500);
    // Find the most recent event that (a) is one of the UNDOABLE_*
    // event_types, (b) was written by this same user, (c) carries prev_state.
    const undoable = (recent ?? []).find((row) => {
      const pl = (row.event_payload ?? {}) as Record<string, unknown>;
      return typeof row.event_type === 'string'
        && (row.event_type.startsWith('manual_mark_')
            || row.event_type === 'manual_assign_to_mia'
            || row.event_type === 'manual_return_to_ai'
            || row.event_type === 'manual_phone_escalation')
        && pl.actor_user_id === staff.userId
        && pl.prev_state && typeof pl.prev_state === 'object'
        && pl.undone !== true;
    });
    if (!undoable) {
      return jsonResponse(req, { error: 'Nothing to undo in window' }, 404);
    }
    const prev = (undoable.event_payload as { prev_state: Record<string, unknown> }).prev_state;
    // Restore the snapshot's columns. Nullables go back to null, booleans
    // to their captured value. We deliberately do NOT re-create old queue
    // items — those are operational follow-ups; if Mia un-wons a lead the
    // human_handoff queue item that mark_won created is left as-is so
    // ops still sees the noise once.
    const restore: Record<string, unknown> = {
      lead_status: prev.lead_status,
      ownership_mode: prev.ownership_mode,
      do_not_contact: prev.do_not_contact ?? false,
      won_at: prev.won_at ?? null,
      lost_at: prev.lost_at ?? null,
      lost_reason: prev.lost_reason ?? null,
      requested_phone_call: prev.requested_phone_call ?? false,
      human_owner_id: prev.human_owner_id ?? null,
      last_human_touch_at: prev.last_human_touch_at ?? null,
    };
    const { error: updErr } = await supabase.from('leads').update(restore).eq('id', leadId);
    if (updErr) return jsonResponse(req, { error: updErr.message }, 500);
    // Flag the original event so a double-undo can't fire.
    await supabase
      .from('lead_events')
      .update({ event_payload: { ...(undoable.event_payload as object), undone: true, undone_by: staff.userId, undone_at: ts } })
      .eq('id', undoable.id);
    await logLeadEvent(supabase, leadId, 'manual_action_undone', staff.role, {
      ...meta, original_event_id: undoable.id, original_event_type: undoable.event_type,
    }, conversationId ?? undefined, staff.userId);
    log.info('admin_action_undone', {
      fn: 'admin-actions', correlationId, userId: staff.userId, leadId,
      originalEvent: undoable.event_type,
    });
    return jsonResponse(req, { ok: true, action, restored: prev, originalEvent: undoable.event_type });
  }

  switch (action) {
    case 'assign_to_mia': {
      await updateLeadFields(supabase, leadId, {
        ownership_mode: 'mia_active',
        human_owner_id: staff.userId,
        last_human_touch_at: ts,
      });
      await transitionLeadStatus(supabase, leadId, 'human_handoff', staff.role, 'manual_assign_to_mia');
      await ensurePendingQueueItem(supabase, {
        leadId, queueType: 'human_handoff', priorityLevel: 2,
        reason: note ?? 'Assigned to Mia manually',
        queueSummary: note ?? 'Manual assignment to Mia',
        payloadJson: meta,
        createdByActorType: staff.role,
      });
      await logLeadEvent(supabase, leadId, 'manual_assign_to_mia', staff.role, meta, conversationId ?? undefined, staff.userId);
      break;
    }
    case 'return_to_ai': {
      await updateLeadFields(supabase, leadId, { ownership_mode: 'ai_active' });
      await logLeadEvent(supabase, leadId, 'manual_return_to_ai', staff.role, meta, conversationId ?? undefined, staff.userId);
      break;
    }
    case 'mark_phone_escalation': {
      await updateLeadFields(supabase, leadId, {
        ownership_mode: 'phone_sales_pending',
        requested_phone_call: true,
        last_human_touch_at: ts,
      });
      await ensurePendingQueueItem(supabase, {
        leadId, queueType: 'phone_escalation', priorityLevel: 1,
        reason: note ?? 'Phone escalation requested',
        queueSummary: note ?? null,
        payloadJson: meta,
        createdByActorType: staff.role,
      });
      await logLeadEvent(supabase, leadId, 'manual_phone_escalation', staff.role, meta, conversationId ?? undefined, staff.userId);
      break;
    }
    case 'mark_dnc': {
      await updateLeadFields(supabase, leadId, { do_not_contact: true });
      await transitionLeadStatus(supabase, leadId, 'do_not_contact', staff.role, 'manual_mark_dnc');
      await logLeadEvent(supabase, leadId, 'manual_mark_dnc', staff.role, meta, conversationId ?? undefined, staff.userId);
      break;
    }
    case 'mark_lost': {
      await updateLeadFields(supabase, leadId, { lost_at: ts, lost_reason: note ?? null });
      await transitionLeadStatus(supabase, leadId, 'lost', staff.role, 'manual_mark_lost');
      await logLeadEvent(supabase, leadId, 'manual_mark_lost', staff.role, meta, conversationId ?? undefined, staff.userId);
      break;
    }
    case 'mark_won': {
      await updateLeadFields(supabase, leadId, { won_at: ts });
      await transitionLeadStatus(supabase, leadId, 'won', staff.role, 'manual_mark_won');
      await logLeadEvent(supabase, leadId, 'manual_mark_won', staff.role, meta, conversationId ?? undefined, staff.userId);
      break;
    }
    case 'log_phone_call': {
      const callMeta = { ...meta, outcome: callOutcome ?? 'connected', duration_minutes: callDurationMinutes ?? null };
      await supabase.from('lead_tasks').insert({
        lead_id: leadId,
        task_type: 'phone_call_logged',
        task_status: 'done',
        owner_type: staff.role === 'sales_rep' ? 'sales_rep' : staff.role,
        owner_user_id: staff.userId,
        title: `שיחת טלפון: ${callOutcome ?? 'connected'}`,
        description: note ?? null,
        priority_level: 3,
        completed_at: ts,
        completion_note: note ?? null,
        payload_json: callMeta,
      });
      await updateLeadFields(supabase, leadId, { last_human_touch_at: ts });
      await logLeadEvent(supabase, leadId, 'phone_call_logged', staff.role, callMeta, conversationId ?? undefined, staff.userId);
      break;
    }
    default:
      return jsonResponse(req, { error: 'Unsupported action' }, 400);
  }

  log.info('admin_action', { fn: 'admin-actions', correlationId, userId: staff.userId, action, leadId });
  return jsonResponse(req, { ok: true, action });
});
