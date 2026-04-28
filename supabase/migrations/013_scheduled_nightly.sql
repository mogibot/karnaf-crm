-- Karnaf CRM Core - Nightly job orchestration via pg_cron + pg_net.
-- Runs at 02:00 Asia/Jerusalem (cron expression in UTC: 23:00 prev-day).

create or replace function public.run_nightly_jobs() returns void
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_url text := current_setting('app.nightly_jobs_url', true);
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'sla_worker_secret' limit 1;
  exception when others then v_secret := null; end;

  if v_url is null or v_url = '' then
    raise notice 'nightly_jobs_url not set; skipping';
    return;
  end if;
  if v_secret is null then
    raise notice 'sla_worker_secret not set; skipping';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;
revoke all on function public.run_nightly_jobs() from public;
grant execute on function public.run_nightly_jobs() to service_role;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'karnaf_nightly_jobs') then
    perform cron.schedule('karnaf_nightly_jobs', '0 23 * * *',
      $cmd$ select public.run_nightly_jobs(); $cmd$);
  end if;
end $$;
