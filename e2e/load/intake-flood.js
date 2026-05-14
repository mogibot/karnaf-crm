// k6 — inbound flood scenario.
//
// Simulates 200 inbound webhook submissions per minute against the
// staging leads-intake. Spikes at minute 3 to 400/min for 60s. Asserts
// p95 < 800ms and error rate < 1%.
//
// Run: k6 run --env-file=.env intake-flood.js

import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL;
const SECRET = __ENV.INTAKE_SECRET;

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: 200, timeUnit: '1m', duration: '10m',
      preAllocatedVUs: 20, maxVUs: 60,
      exec: 'submitOne',
    },
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 200, timeUnit: '1m',
      stages: [
        { target: 200, duration: '2m' },
        { target: 400, duration: '1m' },
        { target: 200, duration: '1m' },
      ],
      preAllocatedVUs: 30, maxVUs: 100,
      exec: 'submitOne',
      startTime: '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed:   ['rate<0.01'],
  },
};

function hmacHex(body, secret) {
  return crypto.hmac('sha256', secret, body, 'hex');
}

function israeliPhone() {
  // Random 9-digit suffix; staging dedupes by phone so we want spread.
  const n = Math.floor(Math.random() * 1e9).toString().padStart(9, '0');
  return `+9725${n.slice(0, 8)}`;
}

export function submitOne() {
  const payload = {
    phone: israeliPhone(),
    full_name: `LoadTest-${__VU}-${__ITER}`,
    source: 'landing_page',
    source_detail: 'k6-intake-flood',
  };
  const body = JSON.stringify(payload);
  const sig = hmacHex(body, SECRET);
  const res = http.post(`${BASE_URL}/leads-intake`, body, {
    headers: {
      'Content-Type': 'application/json',
      'x-karnaf-signature': `sha256=${sig}`,
      'x-correlation-id': `k6-${__VU}-${__ITER}`,
    },
  });
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  // Small sleep so VUs don't all hammer at the exact same instant.
  sleep(Math.random() * 0.1);
}
