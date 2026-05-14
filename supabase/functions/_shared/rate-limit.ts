// Webhook rate limiter backed by `check_rate_limit` RPC. Use it before
// performing any work in a public webhook handler.
//
// Previous behaviour was fail-open on RPC error: if the rate-limit
// table or RPC was unhealthy, the limit didn't apply and ingress could
// be saturated by a burst (intentional or otherwise). Now we keep a
// short-lived in-memory token bucket per key and fall back to it when
// the DB call fails — bounded grace, not unlimited.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { log } from './logger.ts';

export interface RateLimitOptions {
  key: string;
  windowSeconds: number;
  maxRequests: number;
}

// Per-instance fallback. Each edge function instance has its own copy;
// across instances the same key won't share state — that's fine. The
// goal is to refuse runaway bursts during a DB outage, not to enforce
// a global counter (which is what the RPC does when healthy).
interface FallbackBucket {
  windowStartedAt: number;
  count: number;
}
const fallbackBuckets = new Map<string, FallbackBucket>();

function fallbackAllow(opts: RateLimitOptions): boolean {
  const now = Date.now();
  const windowMs = opts.windowSeconds * 1000;
  const bucket = fallbackBuckets.get(opts.key);
  if (!bucket || now - bucket.windowStartedAt >= windowMs) {
    fallbackBuckets.set(opts.key, { windowStartedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= opts.maxRequests) return false;
  bucket.count += 1;
  return true;
}

export async function checkRateLimit(
  supabase: SupabaseClient,
  opts: RateLimitOptions,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_key: opts.key,
    p_window_seconds: opts.windowSeconds,
    p_max_requests: opts.maxRequests,
  });
  if (error) {
    log.warn('rate_limit_rpc_error_using_fallback', {
      fn: 'rate-limit', err: error.message, key: opts.key,
    });
    return fallbackAllow(opts);
  }
  return Boolean(data);
}

export function clientIdentifier(req: Request): string {
  return req.headers.get('cf-connecting-ip')
      || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
}
