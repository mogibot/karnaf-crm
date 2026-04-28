import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { ensurePendingQueueItem } from '../_shared/queue-service.ts';
import { logLeadEvent, transitionLeadStatus } from '../_shared/lead-service.ts';
import { verifyBearer } from '../_shared/webhook-signature.ts';
import { env } from '../_shared/env.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';
import { getRuntimeConfig } from '../_shared/config-service.ts';

// Designed to be invoked by pg_cron via the Supabase scheduler. Every run
// emits operational queue items for leads that have crossed an SLA boundary
// since the last run, idempotently (ensurePendingQueueItem dedupes).

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const correlationId = correlationFromRequest(req);
  const expected = env.slaWorkerSecret() || env.serviceRoleKey();
  if (!verifyBearer(req, expected)) return jsonResponse(req, { error: 'Unauthorized' }, 401);

  const supabase = getServiceSupabase();
  const config = await getRuntimeConfig(supabase);

  const now = Date.now();
  const warn = new Date(now - config.slaThresholds.firstResponseWarnHours * 3600 * 1000).toISOString();
  const breach = new Date(now - config.slaThresholds.firstResponseBreachHours * 3600 * 1000).toISOString();
  const paymentBreach = new Date(now - config.slaThresholds.paymentPendingHours * 3600 * 1000).toISOString();
  const dormantBreach = new Date(now - (config.followUpDelays.nurtureHours * 7) * 3600 * 1000).toISOString();

  const counters: Record<string, number> = { sla_risk: 0, sla_breach: 0, payment_pending: 0, dormant: 0 };

  // SLA risk: lead has inbound but no outbound after warn threshold.
  const { data: slaRiskLeads } = await supabase
    .from('leads')
    .select('id')
    .lt('last_inbound_at', warn)
    .or('last_outbound_at.is.null,last_outbound_at.lt.last_inbound_at')
    .eq('do_not_contact', false)
    .eq('removed_by_request', false);
  for (const lead of slaRiskLeads ?? []) {
    await ensurePendingQueueItem(supabase, {
      leadId: lead.id, queueType: 'sla_risk', priorityLevel: 2,
      reason: `No outbound response within ${config.slaThresholds.firstResponseWarnHours}h`,
      payloadJson: { correlationId, threshold: 'warn' },
    });
    counters.sla_risk++;
  }

  // Hard breach: escalate to mia + emit event.
  const { data: breachLeads } = await supabase
    .from('leads')
    .select('id')
    .lt('last_inbound_at', breach)
    .or('last_outbound_at.is.null,last_outbound_at.lt.last_inbound_at')
    .eq('do_not_contact', false)
    .eq('removed_by_request', false);
  for (const lead of breachLeads ?? []) {
    await ensurePendingQueueItem(supabase, {
      leadId: lead.id, queueType: 'human_handoff', priorityLevel: 1,
      reason: `SLA breach: > ${config.slaThresholds.firstResponseBreachHours}h without response`,
      payloadJson: { correlationId, threshold: 'breach' },
    });
    await logLeadEvent(supabase, lead.id, 'sla_breach', 'system', { correlationId });
    counters.sla_breach++;
  }

  // Payment-pending stuck.
  const { data: paymentStuck } = await supabase
    .from('leads')
    .select('id')
    .eq('lead_status', 'payment_pending')
    .lt('updated_at', paymentBreach);
  for (const lead of paymentStuck ?? []) {
    await ensurePendingQueueItem(supabase, {
      leadId: lead.id, queueType: 'payment_pending', priorityLevel: 1,
      reason: `Payment pending > ${config.slaThresholds.paymentPendingHours}h`,
      payloadJson: { correlationId },
    });
    counters.payment_pending++;
  }

  // Dormant: nurture leads idle for > 7 nurtureHours.
  const { data: dormantLeads } = await supabase
    .from('leads')
    .select('id, lead_status')
    .in('lead_status', ['nurture', 'responded'])
    .lt('updated_at', dormantBreach);
  for (const lead of dormantLeads ?? []) {
    await transitionLeadStatus(supabase, lead.id, 'dormant', 'system', 'sla_worker');
    await ensurePendingQueueItem(supabase, {
      leadId: lead.id, queueType: 'dormant_review', priorityLevel: 3,
      reason: 'Dormant lead; review for reactivation',
      payloadJson: { correlationId },
    });
    counters.dormant++;
  }

  log.info('sla_worker_run', { fn: 'sla-worker', correlationId, counters });
  return jsonResponse(req, { ok: true, counters, correlationId });
});
