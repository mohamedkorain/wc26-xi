-- HALLO AMRIKA scoring cron — one daily morning scoring window.
--
-- Product decision: users do not need live-after-each-match scoring. Scores
-- should update after all games of the day have finished, which is usually
-- around 10-11am Cairo on late-match days.
--
-- The Edge function has a ~130s working budget and resumes with
-- scoring_progress, so this is intentionally a retry window rather than a
-- single HTTP call:
--
--   07:00/07:15/.../09:45 UTC
--   = 11:00-13:45 Dubai / 10:00-12:45 Cairo
--
-- Current UTC date and previous UTC date are staggered by 5 minutes. This
-- catches matches whose kickoff date was yesterday UTC but whose final whistle
-- lands after midnight UTC, without running scoring jobs all day.
--
-- score-day is idempotent:
--   - no FT fixtures: only fixture status is touched
--   - all FT fixtures already scored: expensive player-stat fetches are skipped
--   - newly finished fixture: recomputes all finished fixtures for that date,
--     then refreshes leaderboard caches/ranks
--
-- Secret handling:
--   Do not paste the service_role key directly into cron.job.command. Store the
--   current service_role key in Supabase Vault as:
--
--     score_day_service_role_key
--
--   Then run this file. The cron commands call private.trigger_score_day(),
--   which reads the key from Vault at runtime. That keeps the secret out of
--   cron.job and prevents a placeholder token from being silently scheduled.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Wipe any previous schedule
select cron.unschedule('hallo-amrika-score-day')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-day');
select cron.unschedule('hallo-amrika-score-today')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-today');
select cron.unschedule('hallo-amrika-score-yesterday')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-yesterday');
select cron.unschedule('hallo-amrika-score-two-days-ago')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-two-days-ago');

create or replace function private.trigger_score_day(score_date date)
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
    body := jsonb_build_object('date', score_date::text),
    timeout_milliseconds := 150000
  )
    into request_id;

  return request_id;
end;
$$;

revoke all on function private.trigger_score_day(date) from public, anon, authenticated;

create or replace function public.is_score_day_cron_authorized(auth_header text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  select 'Bearer ' || decrypted_secret
    into expected
  from vault.decrypted_secrets
  where name = 'score_day_service_role_key'
  limit 1;

  return auth_header is not null
     and expected is not null
     and auth_header = expected;
end;
$$;

revoke all on function public.is_score_day_cron_authorized(text) from public, anon, authenticated;
grant execute on function public.is_score_day_cron_authorized(text) to service_role;

-- Current UTC date, every 15 minutes during the morning retry window.
select cron.schedule(
  'hallo-amrika-score-today',
  '*/15 7,8,9 * * *',
  $$select private.trigger_score_day((now() at time zone 'utc')::date);$$
);

-- Previous UTC date, staggered 5 minutes later during the same window.
select cron.schedule(
  'hallo-amrika-score-yesterday',
  '5,20,35,50 7,8,9 * * *',
  $$select private.trigger_score_day(((now() at time zone 'utc')::date - 1));$$
);

-- One missed-day catch-up. Fast when already scored, but protects against an
-- outage or resource-limit day that did not fully complete yesterday.
select cron.schedule(
  'hallo-amrika-score-two-days-ago',
  '10,25,40,55 9 * * *',
  $$select private.trigger_score_day(((now() at time zone 'utc')::date - 2));$$
);

-- Verify
select jobname, schedule, command
from cron.job
where jobname in (
  'hallo-amrika-score-today',
  'hallo-amrika-score-yesterday',
  'hallo-amrika-score-two-days-ago'
)
order by jobname;
