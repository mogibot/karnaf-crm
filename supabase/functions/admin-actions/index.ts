import { getServiceSupabase } from '../_shared/supabase.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { ensurePendingQueueItem } from '../_shared/queue-service.ts';
import { logLeadEvent, updateLeadTimestamps } from '../_shared/lead-service.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const body = await req.json();
  const { action, leadId, conversationId, note } = body;

  if (!action || !leadId) {
    return jsonResponse({ error: 'Missing action or leadId' }, 400);
  }

  const supabase = getServiceSupabase();

  if (action === 'assign_to_mia') {
    await updateLeadTimestamps(supabase, leadId, {
      ownership_mode: 'mia_active',
      lead_status: 'human_handoff',
      last_human_touch_at: new Date().toISOString(),
    });

    await ensurePendingQueueItem(supabase, {
      leadId,
      queueType: 'human_handoff',
      priorityLevel: 2,
      reason: note || 'Assigned to Mia manually',
      queueSummary: note || 'Manual assignment to Mia',
      payloadJson: { initiated_by: 'admin-actions' },
    });

    await logLeadEvent(supabase, leadId, 'manual_assign_to_mia', 'system', {
      note: note || null,
    }, conversationId);

    return jsonResponse({ ok: true, action });
  }

  if (action === 'mark_dnc') {
    await updateLeadTimestamps(supabase, leadId, {
      do_not_contact: true,
      lead_status: 'do_not_contact',
    });

    await logLeadEvent(supabase, leadId, 'manual_mark_dnc', 'system', {
      note: note || null,
    }, conversationId);

    return jsonResponse({ ok: true, action });
  }

  if (action === 'return_to_ai') {
    await updateLeadTimestamps(supabase, leadId, {
      ownership_mode: 'ai_active',
    });

    await logLeadEvent(supabase, leadId, 'manual_return_to_ai', 'system', {
      note: note || null,
    }, conversationId);

    return jsonResponse({ ok: true, action });
  }

  if (action === 'mark_phone_escalation') {
    await updateLeadTimestamps(supabase, leadId, {
      ownership_mode: 'phone_sales_pending',
      requested_phone_call: true,
    });

    await ensurePendingQueueItem(supabase, {
      leadId,
      queueType: 'phone_escalation',
      priorityLevel: 1,
      reason: note || 'Marked for phone escalation manually',
      queueSummary: note || 'Manual phone escalation',
      payloadJson: { initiated_by: 'admin-actions' },
    });

    await logLeadEvent(supabase, leadId, 'manual_phone_escalation', 'system', {
      note: note || null,
    }, conversationId);

    return jsonResponse({ ok: true, action });
  }

  return jsonResponse({ error: 'Unsupported action' }, 400);
});
