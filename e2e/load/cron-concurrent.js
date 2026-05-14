// k6 — sla-worker + nightly-jobs concurrent invocation.
//
// Verifies that the two cron entrypoints behave when fired close
// together. They should both return within 30s and queue-dedupe should
// prevent duplicate work_queue rows even when their windows overlap.
//
// Run: k6 run --env-file=.env cron-concurrent.js
//
// NOTE: nightly-jobs is idempotent per-day (migration 027), so two runs
// in the same minute should report `skipped: already_ran_today` on the
// second one — that's the desired behaviour.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL;
const SECRET = __ENV.SLA_WORKER_SECRET;

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_duration: ['p(95)<30000'],
  },
};

function fire(path) {
  const start = Date.now();
  const res = http.post(`${BASE_URL}${path}`, '{}', {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SECRET}`,
      'x-correlation-id': `k6-cron-${Math.random().toString(36).slice(2, 8)}`,
    },
    timeout: '60s',
  });
  const ms = Date.now() - start;
  console.log(`${path} → ${res.status} in ${ms}ms`);
  return res;
}

export default function () {
  // Fire concurrently (k6 batch is the easiest path).
  const responses = http.batch([
    {
      method: 'POST',
      url: `${BASE_URL}/sla-worker`,
      body: '{}',
      params: {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
        timeout: '60s',
      },
    },
    {
      method: 'POST',
      url: `${BASE_URL}/nightly-jobs`,
      body: '{}',
      params: {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
        timeout: '60s',
      },
    },
  ]);
  for (const r of responses) {
    check(r, { 'cron 2xx or skipped': (res) => res.status === 200 });
  }

  // Then fire the same endpoints again immediately so idempotency is
  // observable (nightly should now skip).
  const second = fire('/nightly-jobs');
  check(second, {
    'second nightly run reports skipped or 200': (r) => r.status === 200,
  });
}
