-- HALLO AMRIKA live score refresh cron.
--
-- This keeps the matchday cards current during live games without awarding
-- fantasy points early. It calls score-day with liveOnly=true, which only
-- refreshes public.matches status/goals from API-Football.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.trigger_score_day(score_date date, live_only boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  service_role_key text;
  request_id bigint;
begin
  select decrypted_secret
    into service_role_key
  from vault.decrypted_secrets
  where name = 'score_day_service_role_key'
  order by created_at desc
  limit 1;

  if service_role_key is null or service_role_key = '' or service_role_key like '<%>' then
    raise exception 'Missing Supabase Vault secret: score_day_service_role_key';
  end if;

  select net.http_post(
    url := 'https://nyytjswemjrybjfmqaaq.functions.supabase.co/score-day',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object('date', score_date::text, 'liveOnly', live_only),
    timeout_milliseconds := 150000
  )
    into request_id;

  return request_id;
end;
$$;

create or replace function private.trigger_score_day(score_date date)
returns bigint
language sql
security definer
set search_path = public
as $$
  select private.trigger_score_day(score_date, false);
$$;

revoke all on function private.trigger_score_day(date) from public, anon, authenticated;
revoke all on function private.trigger_score_day(date, boolean) from public, anon, authenticated;

select cron.unschedule('hallo-amrika-live-today')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-live-today');
select cron.unschedule('hallo-amrika-live-yesterday')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-live-yesterday');

-- 15:00-02:59 Cairo every 10 minutes. The "yesterday" pass covers games
-- whose UTC fixture date started before midnight but finished after it.
select cron.schedule(
  'hallo-amrika-live-today',
  '*/10 12-23 * * *',
  $$select private.trigger_score_day((now() at time zone 'utc')::date, true);$$
);

select cron.schedule(
  'hallo-amrika-live-yesterday',
  '5,15,25,35,45,55 0,1,2 * * *',
  $$select private.trigger_score_day(((now() at time zone 'utc')::date - 1), true);$$
);

select jobname, schedule, command
from cron.job
where jobname in ('hallo-amrika-live-today', 'hallo-amrika-live-yesterday')
order by jobname;
