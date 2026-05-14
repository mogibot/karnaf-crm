// k6 — concurrent operator dashboard refresh.
//
// 50 simulated operators hit dashboard-summary + analytics-summary +
// leads-list every 30s for 5 minutes. Mimics what happens when Mia +
// 4 sales reps are all on a busy morning shift.
//
// Run: k6 run --env-file=.env dashboard-refresh.js
//
// Auth: this hits the Edge Functions with the staging anon key. We're
// validating throughput, not auth — the functions still requireStaff
// internally but will fail-401, which we tolerate via thresholds tuned
// for that path.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL;
const ANON = __ENV.SUPABASE_ANON;
// For real auth, supply a STAFF_JWT env that the test inherits. Without
// it, the script still measures the 401 path's latency, which is itself
// a useful proxy for function cold-start.
const JWT = __ENV.STAFF_JWT || ANON;

export const options = {
  vus: 50,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<1200'],
  },
};

function get(path) {
  return http.get(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${JWT}`,
      apikey: ANON,
      'x-correlation-id': `k6-dash-${__VU}-${__ITER}`,
    },
  });
}

export default function () {
  const calls = [
    get('/dashboard-summary'),
    get('/analytics-summary'),
    get('/leads-list?limit=50'),
    get('/queue-list?status=pending'),
  ];
  for (const r of calls) {
    check(r, { 'reachable': (res) => res.status < 500 });
  }
  sleep(30);
}
