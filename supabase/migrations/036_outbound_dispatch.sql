-- Durable queue for outbound orchestration calls.
-- Today whatsapp-webhook fire-and-forgets the orchestrate-message
-- function; if that request fails (cold start, network blip, edge crash)
-- the inbound message is logged but the AI never replies. This queue
-- gives us bounded retries + a dead-letter shelf for manual triage.

CREATE TABLE IF NOT EXISTS public.outbound_dispatch (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  -- Idempotency anchor — we don't want two dispatch rows for the same
  -- inbound event. lead_events.id is the natural key.
  source_event_id uuid REFERENCES public.lead_events(id) ON DELETE SET NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_flight','succeeded','failed','dlq')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  correlation_id  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  succeeded_at    timestamptz,
  failed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_due
  ON public.outbound_dispatch (status, next_attempt_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_lead
  ON public.outbound_dispatch (lead_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_outbound_dispatch_source_event
  ON public.outbound_dispatch (source_event_id) WHERE source_event_id IS NOT NULL;

-- Claim a batch atomically. SKIP LOCKED ensures concurrent workers
-- don't fight over the same rows. Returns the claimed rows so the
-- caller can dispatch them outside the transaction.
CREATE OR REPLACE FUNCTION public.claim_outbound_dispatch(p_batch_size integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  lead_id uuid,
  conversation_id uuid,
  payload jsonb,
  attempts integer,
  correlation_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT od.id
    FROM public.outbound_dispatch od
    WHERE od.status = 'pending'
      AND od.next_attempt_at <= now()
    ORDER BY od.next_attempt_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbound_dispatch od
     SET status = 'in_flight',
         attempts = od.attempts + 1
   WHERE od.id IN (SELECT id FROM claimed)
  RETURNING od.id, od.lead_id, od.conversation_id, od.payload, od.attempts, od.correlation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_outbound_dispatch(integer) TO service_role;

-- Mark a row as succeeded. Idempotent on succeeded → succeeded.
CREATE OR REPLACE FUNCTION public.complete_outbound_dispatch(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.outbound_dispatch
     SET status = 'succeeded', succeeded_at = now(), last_error = NULL
   WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.complete_outbound_dispatch(uuid) TO service_role;

-- Mark a row as failed. If attempts < max_attempts schedule another
-- run with exponential backoff (1m / 4m / 16m / 1h / 4h). Otherwise
-- shelve in dlq for manual triage.
CREATE OR REPLACE FUNCTION public.fail_outbound_dispatch(p_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
  v_max integer;
  v_delay interval;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max
    FROM public.outbound_dispatch WHERE id = p_id;

  IF v_attempts IS NULL THEN RETURN; END IF;

  IF v_attempts >= v_max THEN
    UPDATE public.outbound_dispatch
       SET status = 'dlq', failed_at = now(), last_error = p_error
     WHERE id = p_id;
  ELSE
    -- 4^attempt minutes, capped at 4 hours
    v_delay := LEAST(power(4, v_attempts) * interval '1 minute', interval '4 hours');
    UPDATE public.outbound_dispatch
       SET status = 'pending',
           next_attempt_at = now() + v_delay,
           last_error = p_error
     WHERE id = p_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fail_outbound_dispatch(uuid, text) TO service_role;

-- pg_cron wrapper that pokes the dispatch-outbound edge function.
CREATE OR REPLACE FUNCTION public.run_outbound_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url text := current_setting('app.outbound_dispatch_url', true);
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'outbound_dispatch_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_secret := NULL; END;

  IF v_url IS NULL OR v_url = '' THEN
    RAISE NOTICE 'outbound_dispatch_url not set; skipping';
    RETURN;
  END IF;
  IF v_secret IS NULL THEN
    RAISE NOTICE 'outbound_dispatch_secret not set; skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION public.run_outbound_dispatch() FROM public;
GRANT EXECUTE ON FUNCTION public.run_outbound_dispatch() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'karnaf_outbound_dispatch') THEN
    PERFORM cron.schedule('karnaf_outbound_dispatch', '* * * * *', $cmd$ select public.run_outbound_dispatch(); $cmd$);
  END IF;
END $$;
