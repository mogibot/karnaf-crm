# Real-device QA matrix

Devices the Karnaf CRM is expected to work on, with the Playwright
project name that emulates each. Use this matrix for:

- Pre-release smoke checks before any UI-touching deploy.
- The pilot QA pass (see `docs/pilot/scenarios.md`).
- Regression triage when "it works on my laptop but Mia says broken."

## Tier 1 — must work (block release if broken)

| Device class            | Real model        | Playwright project   | Why it matters                       |
|-------------------------|-------------------|----------------------|--------------------------------------|
| Desktop, Hebrew-RTL     | MacBook / Win Edge | `chromium`           | Owner/admin daily driver             |
| iPhone (recent)         | iPhone 14/15      | `mobile-safari`      | Mia's car-and-coffee workflow        |
| Android, Chrome         | Pixel 7           | `mobile-chrome`      | Most sales rep phones                |
| Slow network            | 4G throttled      | `slow-4g`            | Real-world cell coverage in Israel   |

## Tier 2 — should work (file but don't block)

| Device class            | Real model           | Playwright project   |
|-------------------------|----------------------|----------------------|
| Samsung Galaxy          | S9+ / S22            | `samsung-internet`   |
| iPad                    | iPad Air             | n/a (real-device only) |
| Old Android (< 12)      | physical device      | n/a — manual           |

## Tier 3 — best effort

| Class            | Notes                                              |
|------------------|----------------------------------------------------|
| Firefox desktop  | Mostly works; some Tailwind RTL edge cases.        |
| Mobile Safari iOS 15 | Pre-iOS 16 Safari lacks `text-balance`; expect minor.|

## How to run a slice

```bash
# Just iPhone:
npx playwright test --project=mobile-safari

# Slow-network simulation:
npx playwright test --project=slow-4g e2e/manual-lead-flow.spec.ts

# Full mobile sweep (skip desktop):
npx playwright test --project=mobile-safari --project=mobile-chrome --project=samsung-internet
```

## What to look for, per device class

### iPhone Safari
- RTL layout doesn't break when the screen rotates (landscape).
- The conversation transcript scrolls smoothly (it had a quirk on
  iOS 15 with `overflow-y: auto` + `max-h-[60vh]`).
- `tel:` links on phone numbers actually open the dialer.
- VoiceOver reads the Hebrew status badges correctly.

### Pixel / Chrome Android
- Touch targets ≥ 44×44 (P2.8 — `.kf-btn` enforces via @media coarse).
- Bulk-action sticky bar doesn't cover important content on small screens.
- Browser Notification API is permissioned correctly (P2.9 — first
  visit to `/queue` asks once).

### Samsung Internet
- Hebrew renders right-to-left even under Samsung's default browser font.
- Pull-to-refresh doesn't interfere with sticky bar.

### Slow-4G profile
- React Query optimistic updates feel snappy (P2.4 — claim button flips
  instantly even on poor network).
- Real-time presence (P2.5) doesn't spam errors when WebSocket can't
  hold a connection — should fall back to empty viewer list silently.
- Notifications don't pile up if Supabase Realtime disconnects + reconnects.

## Sign-off template

Copy this into each release notes doc:

```
### Device matrix
- [ ] chromium                  pass / known issue: ...
- [ ] mobile-safari             pass / known issue: ...
- [ ] mobile-chrome             pass / known issue: ...
- [ ] samsung-internet          pass / known issue: ...
- [ ] slow-4g                   pass / known issue: ...
- [ ] real iPhone (manual)      pass / known issue: ...
- [ ] real Android (manual)     pass / known issue: ...
```
