-- Karnaf CRM Core - Triggers for updated_at maintenance and conversation activity sync.

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_leads_set_updated_at on leads;
create trigger trg_leads_set_updated_at
  before update on leads
  for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_set_updated_at on profiles;
create trigger trg_profiles_set_updated_at
  before update on profiles
  for each row execute function public.set_updated_at();

-- Maintain conversations.last_activity_at and direction-specific timestamps
-- whenever a message row is inserted.
create or replace function public.sync_conversation_activity() returns trigger
language plpgsql as $$
begin
  update conversations set
    last_activity_at = coalesce(new.created_at, now()),
    last_inbound_at = case when new.direction = 'inbound'
                            then coalesce(new.created_at, now())
                            else last_inbound_at end,
    last_outbound_at = case when new.direction = 'outbound'
                             then coalesce(new.created_at, now())
                             else last_outbound_at end
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_messages_sync_conversation on messages;
create trigger trg_messages_sync_conversation
  after insert on messages
  for each row execute function public.sync_conversation_activity();

-- Mirror message direction onto the lead row for fast SLA/queue scans.
create or replace function public.sync_lead_message_timestamps() returns trigger
language plpgsql as $$
declare
  ts timestamptz := coalesce(new.created_at, now());
begin
  update leads set
    last_message_at = ts,
    last_inbound_at = case when new.direction = 'inbound' then ts else last_inbound_at end,
    last_outbound_at = case when new.direction = 'outbound' then ts else last_outbound_at end,
    last_ai_touch_at = case when new.sender_type = 'ai' then ts else last_ai_touch_at end,
    last_human_touch_at = case when new.sender_type in ('mia','sales_rep','admin') then ts else last_human_touch_at end
  where id = new.lead_id;
  return new;
end;
$$;

drop trigger if exists trg_messages_sync_lead on messages;
create trigger trg_messages_sync_lead
  after insert on messages
  for each row execute function public.sync_lead_message_timestamps();
