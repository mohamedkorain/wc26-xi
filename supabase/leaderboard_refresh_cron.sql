-- Direct database refresh after the morning scoring window.
--
-- Why: score-day runs as an Edge Function and calls RPCs through PostgREST.
-- Long leaderboard materialized-view refreshes can exceed PostgREST's request
-- timeout, leaving leaderboard_totals stale even when raw scores are correct.
--
-- This pg_cron job runs inside Postgres, so it can refresh the leaderboard
-- cache/ranks directly after the normal Cairo scoring window has ended.

create extension if not exists pg_cron;

select cron.unschedule('hallo-amrika-refresh-leaderboard')
where exists (
  select 1
  from cron.job
  where jobname = 'hallo-amrika-refresh-leaderboard'
);

-- 09:00 UTC = 12:00 Cairo during the tournament window.
-- Scoring jobs run 07:00-08:50 UTC, so this lands after all retry passes.
select cron.schedule(
  'hallo-amrika-refresh-leaderboard',
  '0 9 * * *',
  $$select public.refresh_leaderboard_and_ranks();$$
);

select jobname, schedule, command
from cron.job
where jobname = 'hallo-amrika-refresh-leaderboard';
