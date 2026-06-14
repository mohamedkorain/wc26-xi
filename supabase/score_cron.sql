-- HALLO AMRIKA scoring cron — one daily morning scoring window.
--
-- Product decision: users do not need live-after-each-match scoring. Scores
-- should update after all games of the day have finished, which is usually
-- around 10-11am Dubai on late-match days.
--
-- The Edge function has a ~130s working budget and resumes with
-- scoring_progress, so this is intentionally a retry window rather than a
-- single HTTP call:
--
--   07:00/07:15/07:30/07:45/08:00/08:15/08:30/08:45 UTC
--   = 11:00-12:45 Dubai / 10:00-11:45 Cairo
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

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Wipe any previous schedule
select cron.unschedule('hallo-amrika-score-day')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-day');
select cron.unschedule('hallo-amrika-score-today')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-today');
select cron.unschedule('hallo-amrika-score-yesterday')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-yesterday');

-- Current UTC date, every 15 minutes during the morning window.
select cron.schedule(
  'hallo-amrika-score-today',
  '*/15 7,8 * * *',
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
  $$
);

-- Previous UTC date, staggered 5 minutes later during the same window.
select cron.schedule(
  'hallo-amrika-score-yesterday',
  '5,20,35,50 7,8 * * *',
  $$
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
select jobname, schedule, command
from cron.job
where jobname in ('hallo-amrika-score-today', 'hallo-amrika-score-yesterday')
order by jobname;
