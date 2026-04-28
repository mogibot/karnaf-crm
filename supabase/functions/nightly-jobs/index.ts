// Nightly housekeeping jobs invoked by pg_cron at 02:00 Asia/Jerusalem.
// Runs lead score decay, anonymises PII for removed leads beyond the
// retention window, and compacts integration_logs.

import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { verifyBearer } from '../_shared/webhook-signature.ts';
import { env } from '../_shared/env.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const correlationId = correlationFromRequest(req);
  const expected = env.slaWorkerSecret() || env.serviceRoleKey();
  if (!verifyBearer(req, expected)) return jsonResponse(req, { error: 'Unauthorized' }, 401);

  const supabase = getServiceSupabase();

  const [decayRes, purgeRes, compactRes] = await Promise.all([
    supabase.rpc('apply_lead_score_decay'),
    supabase.rpc('purge_removed_pii', { p_retention_days: 30 }),
    supabase.rpc('compact_integration_logs', { p_keep_days: 14 }),
  ]);

  if (decayRes.error) log.error('decay_failed', { fn: 'nightly-jobs', correlationId, err: decayRes.error.message });
  if (purgeRes.error) log.error('purge_failed', { fn: 'nightly-jobs', correlationId, err: purgeRes.error.message });
  if (compactRes.error) log.error('compact_failed', { fn: 'nightly-jobs', correlationId, err: compactRes.error.message });

  const summary = {
    decayed: decayRes.data ?? null,
    purged: purgeRes.data ?? null,
    logsCompacted: compactRes.data ?? null,
  };

  log.info('nightly_jobs_run', { fn: 'nightly-jobs', correlationId, ...summary });
  return jsonResponse(req, { ok: true, correlationId, ...summary });
});
