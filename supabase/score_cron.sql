-- HALLO AMRIKA scoring cron — fires 3× daily and processes BOTH
-- yesterday UTC and today UTC each run so late-night matches (Brazil-
-- Morocco ending ~01:00 Cairo / 22:00 UTC) get caught on the same day.
--
--   12:30 AM Cairo  = 21:30 UTC (previous calendar day)
--    3:30 AM Cairo  = 00:30 UTC
--   10:30 AM Cairo  = 07:30 UTC
--
-- Each run also triggers the materialized-view refresh internally (via
-- the score-day function's end-of-run RPC), so Top Players + entry ranks
-- stay fresh without a separate cron.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Wipe any previous schedule
select cron.unschedule('hallo-amrika-score-day')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-day');

-- 3× daily at 21:30 / 00:30 / 07:30 UTC. Each run scores today + yesterday.
select cron.schedule(
  'hallo-amrika-score-day',
  '30 21,0,7 * * *',
  $$
  select net.http_post(
    url := 'https://nyytjswemjrybjfmqaaq.functions.supabase.co/score-day',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- IMPORTANT: replace <PASTE_SERVICE_ROLE_KEY> with the actual service_role
      -- secret from https://supabase.com/dashboard/project/_/settings/api-keys
      -- before running this SQL.
      'Authorization', 'Bearer <PASTE_SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('date', (now() at time zone 'utc')::date::text)
  );
  select net.http_post(
    url := 'https://nyytjswemjrybjfmqaaq.functions.supabase.co/score-day',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <PASTE_SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('date', ((now() at time zone 'utc')::date - 1)::text)
  );
  $$
);

-- Verify
select jobname, schedule, command from cron.job where jobname = 'hallo-amrika-score-day';
