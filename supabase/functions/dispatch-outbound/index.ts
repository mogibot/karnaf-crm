// Worker that drains the outbound_dispatch queue. Triggered every
// minute by pg_cron (see migration 030). Claims a small batch, calls
// orchestrate-message per row, and marks success or schedules a retry
// with exponential backoff.
//
// Authenticated with a shared secret — same pattern as sla-worker.

import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { verifyBearer } from '../_shared/webhook-signature.ts';
import { env } from '../_shared/env.ts';
import { correlationFromRequest, log, newCorrelationId } from '../_shared/logger.ts';

interface DispatchRow {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  correlation_id: string | null;
}

const BATCH_SIZE = 10;
const ORCHESTRATE_TIMEOUT_MS = 25_000;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const correlationId = correlationFromRequest(req);
  const secret = env.outboundDispatchSecret();
  if (!secret) {
    log.warn('outbound_dispatch_secret_missing', { fn: 'dispatch-outbound', correlationId });
    return jsonResponse(req, { error: 'Worker secret not configured' }, 503);
  }
  if (!verifyBearer(req, secret)) {
    return jsonResponse(req, { error: 'Unauthorized' }, 401);
  }

  const supabase = getServiceSupabase();
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_outbound_dispatch', {
    p_batch_size: BATCH_SIZE,
  });
  if (claimErr) {
    log.error('claim_failed', { fn: 'dispatch-outbound', correlationId, err: claimErr.message });
    return jsonResponse(req, { error: claimErr.message }, 500);
  }
  const rows = (claimed ?? []) as DispatchRow[];

  if (rows.length === 0) {
    return jsonResponse(req, { ok: true, processed: 0 });
  }

  const orchestrateUrl = `${env.supabaseUrl()}/functions/v1/orchestrate-message`;

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const rowCorrelationId = row.correlation_id ?? newCorrelationId();
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), ORCHESTRATE_TIMEOUT_MS);
      const res = await fetch(orchestrateUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.serviceRoleKey()}`,
          'Content-Type': 'application/json',
          'x-correlation-id': rowCorrelationId,
        },
        body: JSON.stringify({
          leadId: row.lead_id,
          conversationId: row.conversation_id,
          ...row.payload,
        }),
        signal: ac.signal,
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`orchestrate ${res.status}: ${text.slice(0, 200)}`);
      }

      await supabase.rpc('complete_outbound_dispatch', { p_id: row.id });
      succeeded += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      log.error('dispatch_attempt_failed', {
        fn: 'dispatch-outbound',
        correlationId: rowCorrelationId,
        dispatchId: row.id,
        attempt: row.attempts,
        err: message,
      });
      await supabase.rpc('fail_outbound_dispatch', { p_id: row.id, p_error: message });
    }
  }

  log.info('dispatch_batch_done', {
    fn: 'dispatch-outbound', correlationId, processed: rows.length, succeeded, failed,
  });
  return jsonResponse(req, { ok: true, processed: rows.length, succeeded, failed });
});
