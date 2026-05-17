-- Team workload summary RPC. Powers /team in the CRM so owners and
-- admins see who is owning what and who is active. Kept as a single
-- read-only function (no view) so we can change the shape later
-- without an ALTER VIEW dance.

CREATE OR REPLACE FUNCTION public.team_workload_summary()
RETURNS TABLE(
  user_id uuid,
  email text,
  full_name text,
  role text,
  is_active boolean,
  active_leads_owned integer,
  recent_touches_7d integer,
  last_active_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id                                          AS user_id,
    p.email                                       AS email,
    p.full_name                                   AS full_name,
    p.role                                        AS role,
    p.is_active                                   AS is_active,
    COALESCE(owned.active_leads, 0)               AS active_leads_owned,
    COALESCE(touches.touches_7d, 0)               AS recent_touches_7d,
    touches.last_active_at                        AS last_active_at
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS active_leads
    FROM public.leads l
    WHERE l.human_owner_id = p.id
      AND l.lead_status NOT IN ('won', 'lost', 'do_not_contact', 'dormant', 'removed_by_request', 'duplicate')
  ) owned ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      count(*)::int          AS touches_7d,
      max(e.created_at)      AS last_active_at
    FROM public.lead_events e
    WHERE e.actor_id = p.id
      AND e.created_at >= now() - interval '7 days'
  ) touches ON TRUE
  WHERE p.role IN ('owner', 'admin', 'mia', 'sales_rep')
  ORDER BY p.is_active DESC, owned.active_leads DESC NULLS LAST, p.full_name NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.team_workload_summary() TO service_role;
