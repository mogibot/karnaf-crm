-- Request-level idempotency for public webhooks.
-- leads-intake currently relies on upsert_lead_smart to de-dup by
-- phone/email, but two retries of the same payload from a flaky caller
-- (Zapier/Make) can still produce duplicate lead_events and second
-- intake_received notices. This table caches the response for a short
-- TTL keyed by an explicit `idempotency-key` header (or the SHA-256 of
-- the body when the caller doesn't supply one).

CREATE TABLE IF NOT EXISTS public.webhook_idempotency (
  key         text PRIMARY KEY,
  source      text NOT NULL,
  response    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_expires
  ON public.webhook_idempotency (expires_at);

-- Reaper called from the existing nightly job (see scheduled_jobs.sql).
CREATE OR REPLACE FUNCTION public.purge_expired_webhook_idempotency()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.webhook_idempotency WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_expired_webhook_idempotency() TO service_role;
