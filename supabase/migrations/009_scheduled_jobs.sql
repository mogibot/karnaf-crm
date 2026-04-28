-- Karnaf CRM Core - Scheduled jobs.
-- Requires the pg_cron and pg_net extensions enabled in Supabase project.
-- The job calls the sla-worker Edge Function once every 10 minutes during
-- working hours. Auth uses a shared bearer token stored in vault.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper that calls the sla-worker function. The bearer token is read from
-- the vault.secrets table; if the secret is missing the call simply no-ops.
create or replace function public.run_sla_worker() returns void
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_url text := current_setting('app.sla_worker_url', true);
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sla_worker_secret' limit 1;
  exception when others then v_secret := null; end;

  if v_url is null or v_url = '' then
    raise notice 'sla_worker_url not set; skipping';
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
revoke all on function public.run_sla_worker() from public;
grant execute on function public.run_sla_worker() to service_role;

-- Schedule every 10 minutes. Operators can adjust via supabase dashboard.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'karnaf_sla_worker') then
    perform cron.schedule('karnaf_sla_worker', '*/10 * * * *', $cmd$ select public.run_sla_worker(); $cmd$);
  end if;
end $$;
