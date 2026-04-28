import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { ensurePendingQueueItem, resolveQueueItem } from '../_shared/queue-service.ts';
import { logLeadEvent, transitionLeadStatus, updateLeadFields } from '../_shared/lead-service.ts';
import { AuthError, requireStaff } from '../_shared/auth.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';

type ActionName =
  | 'assign_to_mia'
  | 'return_to_ai'
  | 'mark_phone_escalation'
  | 'mark_dnc'
  | 'mark_lost'
  | 'mark_won'
  | 'resolve_queue'
  | 'log_phone_call';

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
    staff = await requireStaff(req, { allow: ['owner', 'admin', 'mia', 'sales_rep'] });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(req, { error: err.message }, err.status);
    throw err;
  }

  const body = await req.json().catch(() => ({})) as ActionPayload;
  const { action, leadId, conversationId, queueItemId, note, callOutcome, callDurationMinutes } = body;

  if (!action) return jsonResponse(req, { error: 'Missing action' }, 400);

  const supabase = getServiceSupabase();

  if (action === 'resolve_queue') {
    if (!queueItemId) return jsonResponse(req, { error: 'Missing queueItemId' }, 400);
    await resolveQueueItem(supabase, queueItemId, note ?? null);
    log.info('admin_action', { fn: 'admin-actions', correlationId, userId: staff.userId, action });
    return jsonResponse(req, { ok: true, action });
  }

  if (!leadId) return jsonResponse(req, { error: 'Missing leadId' }, 400);

  const meta = { actor_user_id: staff.userId, role: staff.role, note: note ?? null, correlation_id: correlationId };
  const ts = new Date().toISOString();

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
