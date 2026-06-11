-- Schedule the score-day Edge Function to fire daily at 04:00 UTC
-- (= 07:00 Cairo). All WC26 matches for the previous day should be finished
-- by then, so the function pulls "yesterday's date" and scores cleanly.
--
-- Pre-requisites:
--   1. Edge Function "score-day" deployed (supabase functions deploy score-day)
--   2. API_FOOTBALL_KEY env var set on the function:
--        supabase secrets set API_FOOTBALL_KEY=<the key>
--
-- Run this AFTER the function is deployed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Wipe any previous schedule
select cron.unschedule('hallo-amrika-score-day')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-day');

-- Daily at 04:00 UTC
select cron.schedule(
  'hallo-amrika-score-day',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://nyytjswemjrybjfmqaaq.functions.supabase.co/score-day',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verify
select jobname, schedule, command from cron.job where jobname = 'hallo-amrika-score-day';
