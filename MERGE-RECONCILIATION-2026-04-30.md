# Merge reconciliation plan — 2026-04-30

## Verified branch reality

- Local branch: `master`
- Remote branch: `origin/master`
- Current divergence after fresh fetch: local is `ahead 13, behind 12`
- Merge base: `7ee800faaae64b73fd324e707f8c190fe83bc929`

## Local-only commits to preserve

1. `dda5e3e` — Add structured open work plan
2. `ab10dba` — Harden operator workflows and deploy readiness
3. `537fedc` — Expose admin queue reassignment in web shell
4. `01a55f4` — Document AI runtime production policy
5. `846fbe1` — Improve operator token bootstrap UX
6. `4a22199` — Expose queue state in lead detail
7. `e9ead86` — Require queue resolution note presets
8. `df602d3` — Script disposable Supabase webhook replay validation
9. `9f185ab` — Assert webhook fixture DB effects
10. `b15f580` — Validate queue admin actions in CI
11. `b996f9c` — Capture CI disposable validation logs
12. `108f622` — Enable local Deno function validation
13. `e04338e` — Align CI workflow and build validation gate

## Remote-only track now present on `origin/master`

The remote line is no longer the same app shape. It introduces a larger routed frontend and expanded runtime surface, including:

- routed auth/pages layout (`LoginPage`, `DashboardPage`, `LeadsPage`, `LeadDetailPage`, `QueuePage`, `UsersPage`, `AnalyticsPage`, `PromptVariantsPage`)
- new shared runtime layer under `lib/runtime/*`
- new functions including `analytics-summary`, `users-manage`, `nightly-jobs`, `prompt-variants`, `send-reply`, `sla-worker`, `email-webhook`
- migration chain through `018_cohort_analytics.sql`
- new docs baseline including `HANDOFF.md`

## Result of first merge attempt

I executed a local merge attempt (`git merge --no-ff origin/master`) and then aborted it safely after inspection.

### Conflict classes confirmed

1. **Same-path docs/config conflicts**
   - `.github/workflows/ci.yml`
   - `.gitignore`
   - `DEPLOYMENT.md`
   - `IMPLEMENTATION-STATUS.md`
   - `OPEN-WORK-PLAN.md`
   - `package.json`
   - `package-lock.json`
   - `supabase/config.toml`
   - `vitest.config.ts`
   - `eslint.config.js`

2. **Frontend architecture conflicts**
   - local branch still extends the simpler shell (`App.tsx`, `api.ts`, `TopNav`, `QueueList`, `LeadDetailPanel`, `LeadsTable`)
   - remote branch deletes or replaces those paths with routed/page-based structure and `apps/web/src/lib/*`

3. **Edge-function shared-runtime conflicts**
   - both branches changed the same shared files under `supabase/functions/_shared/*`
   - especially high-risk overlap in auth, AI validation, queue service, env handling, provider handling, and Supabase client wiring

4. **Domain-model drift**
   - local branch added operator-auth, queue ownership, webhook-hardening, and validation scaffolding on top of an older migration layout
   - remote branch moved further ahead with broader runtime/migration expansion

## Recommended reconciliation strategy

### Recommended base

Use `origin/master` as the structural base, then port the local hardening work intentionally instead of trying to keep the old shell as primary.

Why:
- remote already carries the newer app architecture
- many local conflicts are modify/delete clashes caused by the old shell surviving only locally
- trying to preserve the local shell as the merge base would force re-porting the larger routed app backward

### Porting order

1. **CI/build gate layer**
   - re-apply Deno/static-function validation
   - re-apply helper-script checks and disposable-stack artifact capture
   - merge `.github/workflows/ci.yml`, `package.json`, `deno.json`, `scripts/*`

2. **Webhook hardening + validation fixtures**
   - port `_shared/webhook-security.ts`
   - port replay/assert scripts and fixture docs
   - re-fit handlers to remote runtime abstractions

3. **Operator auth + queue governance**
   - port `_shared/operator-auth.ts`
   - port queue claim/release/resolve/reassign behavior
   - re-map queue UI behavior into routed pages instead of the legacy shell

4. **Docs and readiness contracts**
   - port env contract, AI runtime policy, provisioning, rollback, and rate-limiting decisions
   - regenerate `IMPLEMENTATION-STATUS.md` and `OPEN-WORK-PLAN.md` against the merged codebase instead of line-merging the old versions

## Practical next move

Create a temporary integration branch from `origin/master`, then cherry-pick or manually port the local commits in the order above, validating after each layer. That is the safest path to a pushable result.

## Current blocker

This is no longer a simple fast-forward/rebase cleanup. The blocker is **substantial architecture divergence between local and remote app/runtime trees**, not missing credentials.
