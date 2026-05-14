#!/usr/bin/env bash
# Lightweight wrapper around `supabase db dump` + smoke checks against
# a restored project. Used by the quarterly drill (see
# docs/runbooks/backup-restore.md).
#
# Usage:
#   ./restore-from-pitr.sh smoke <scratch-project-ref>
#   ./restore-from-pitr.sh diff  <prod-ref> <scratch-ref>
#
# Prereqs:
#   * supabase CLI installed and logged in (`supabase login`).
#   * SUPABASE_ACCESS_TOKEN env exported (or interactive login session).

set -euo pipefail

mode="${1:-}"

case "$mode" in
  smoke)
    target="${2:?missing target project ref}"
    echo "[smoke] linking to $target"
    supabase link --project-ref "$target" >/dev/null
    echo "[smoke] running read probes…"
    supabase db remote sql --linked --file - <<SQL
-- Each of these should return a non-empty result; an empty/error
-- response means the restore is incomplete.
select 'leads_count'   as probe, count(*)::text as value from leads
union all
select 'migrations'    as probe, count(*)::text as value from supabase_migrations.schema_migrations
union all
select 'rls_policies'  as probe, count(*)::text as value from pg_policies where schemaname='public'
union all
select 'cron_jobs'     as probe, count(*)::text as value from cron.job;
SQL
    ;;
  diff)
    src="${2:?missing source ref}"; dst="${3:?missing target ref}"
    echo "[diff] comparing $src → $dst"
    # Note: requires CLI ≥ 1.x with --linked-source/--linked-target flags.
    supabase db diff --linked-source "$src" --linked-target "$dst"
    ;;
  *)
    echo "Usage: $0 {smoke|diff} <args...>" >&2
    exit 2
    ;;
esac
