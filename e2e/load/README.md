# Load test harness (k6)

Runnable load profiles for the three peak-hour scenarios the audit
called out. Default target is **staging** — never run these against the
production project unless you've explicitly disabled rate-limits + AI
auto-reply for the test window.

Scenarios live in this directory:

| File                   | Scenario                       | Cadence                    |
|------------------------|--------------------------------|----------------------------|
| `intake-flood.js`      | 200 inbound msg/min for 10min  | Spike at minute 3, decay   |
| `dashboard-refresh.js` | 50 concurrent operators        | Sustained 5min             |
| `cron-concurrent.js`   | sla-worker + nightly together  | Triggers both via Edge fn  |

## Install

```bash
# Windows — winget
winget install k6 --source=winget
# macOS — homebrew
brew install k6
```

## Configure

Create `e2e/load/.env` (gitignored) with:

```env
BASE_URL=https://svkzkpgccahwmyflobvn-staging.functions.supabase.co
INTAKE_SECRET=<staging INTAKE_WEBHOOK_SECRET>
SLA_WORKER_SECRET=<staging SLA_WORKER_SECRET>
SUPABASE_ANON=<staging anon key>
```

## Run

```bash
cd e2e/load
k6 run --env-file=.env intake-flood.js
k6 run --env-file=.env dashboard-refresh.js
k6 run --env-file=.env cron-concurrent.js
```

## Pass thresholds

The scripts set thresholds via the standard k6 `thresholds` block:

* `intake-flood`: p95 < 800ms, error rate < 1%.
* `dashboard-refresh`: p95 < 1200ms (analytics query is the slowest).
* `cron-concurrent`: just verifies both endpoints respond ≤ 30s.

Out-of-budget runs fail the workflow.

## CI integration

`.github/workflows/load.yml` runs all three on `workflow_dispatch`. Don't
schedule them — they cost time + Supabase function invocations.
