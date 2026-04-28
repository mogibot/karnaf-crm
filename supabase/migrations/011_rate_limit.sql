-- Karnaf CRM Core - DB-backed token bucket for webhook abuse protection.
--
-- Each webhook hits `check_rate_limit` with a key (e.g. "whatsapp:<ip>")
-- and a sliding window. Implemented as a counter-with-restart pattern: on
-- conflict the row is updated atomically. Cheap enough for the volumes we
-- expect; not designed for global high-RPS scenarios.

create table if not exists webhook_rate_limit (
  bucket_key text primary key,
  request_count int not null default 0,
  window_started_at timestamptz not null default now()
);

create index if not exists idx_webhook_rate_limit_window on webhook_rate_limit(window_started_at);

-- Returns true when the request is allowed, false when the bucket is full.
create or replace function public.check_rate_limit(
  p_key text,
  p_window_seconds int,
  p_max_requests int
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := now();
  v_count int;
begin
  insert into webhook_rate_limit as r (bucket_key, request_count, window_started_at)
  values (p_key, 1, v_now)
  on conflict (bucket_key) do update set
    request_count = case
      when v_now - r.window_started_at > make_interval(secs => p_window_seconds)
        then 1
      else r.request_count + 1
    end,
    window_started_at = case
      when v_now - r.window_started_at > make_interval(secs => p_window_seconds)
        then v_now
      else r.window_started_at
    end
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;
revoke all on function public.check_rate_limit(text,int,int) from public;
grant execute on function public.check_rate_limit(text,int,int) to service_role;

-- Periodic cleanup so the table can't grow unbounded. Cron runs hourly.
create or replace function public.purge_rate_limit_buckets() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_deleted int;
begin
  delete from webhook_rate_limit where window_started_at < now() - interval '1 hour'
  returning 1 into v_deleted;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.purge_rate_limit_buckets() from public;
grant execute on function public.purge_rate_limit_buckets() to service_role;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'karnaf_purge_rate_limit') then
    perform cron.schedule('karnaf_purge_rate_limit', '15 * * * *',
      $cmd$ select public.purge_rate_limit_buckets(); $cmd$);
  end if;
end $$;
