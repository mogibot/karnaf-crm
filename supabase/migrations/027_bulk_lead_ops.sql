-- Bulk lead operations called from the CRM "Leads" page.
-- The RPC pattern keeps the multi-row update + audit insert atomic.

CREATE OR REPLACE FUNCTION public.bulk_assign_lead_owner(
  p_lead_ids uuid[],
  p_assignee_user_id uuid,
  p_actor_role text,
  p_actor_id uuid,
  p_correlation_id text DEFAULT NULL
)
RETURNS TABLE(updated_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'lead_ids required';
  END IF;
  IF p_assignee_user_id IS NULL THEN
    RAISE EXCEPTION 'assignee required';
  END IF;

  UPDATE public.leads
     SET human_owner_id   = p_assignee_user_id,
         last_human_touch_at = now()
   WHERE id = ANY(p_lead_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.lead_events
    (lead_id, event_type, actor_type, actor_id, event_payload)
  SELECT id,
         'bulk_assign_owner',
         p_actor_role,
         p_actor_id,
         jsonb_build_object(
           'assignee_user_id', p_assignee_user_id,
           'correlation_id', p_correlation_id,
           'batch_size', v_count
         )
  FROM public.leads WHERE id = ANY(p_lead_ids);

  RETURN QUERY SELECT v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_change_lead_heat(
  p_lead_ids uuid[],
  p_heat text,
  p_actor_role text,
  p_actor_id uuid,
  p_correlation_id text DEFAULT NULL
)
RETURNS TABLE(updated_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'lead_ids required';
  END IF;
  IF p_heat NOT IN ('hot','warm','cool','cold') THEN
    RAISE EXCEPTION 'invalid heat value: %', p_heat;
  END IF;

  UPDATE public.leads
     SET lead_heat = p_heat
   WHERE id = ANY(p_lead_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.lead_events
    (lead_id, event_type, actor_type, actor_id, event_payload)
  SELECT id,
         'bulk_change_heat',
         p_actor_role,
         p_actor_id,
         jsonb_build_object(
           'heat', p_heat,
           'correlation_id', p_correlation_id,
           'batch_size', v_count
         )
  FROM public.leads WHERE id = ANY(p_lead_ids);

  RETURN QUERY SELECT v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_assign_lead_owner(uuid[], uuid, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_change_lead_heat(uuid[], text, text, uuid, text) TO service_role;
