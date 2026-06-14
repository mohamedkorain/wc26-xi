-- Refresh the materialized player_leaderboard view every 5 minutes.
-- Decoupled from score-day so it still happens even when the scoring
-- function times out before reaching its end-of-run refresh.
-- (Cheap — concurrent refresh, ~1-2s.)

create extension if not exists pg_cron;

select cron.unschedule('hallo-amrika-refresh-views')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-refresh-views');

select cron.schedule(
  'hallo-amrika-refresh-views',
  '*/5 * * * *',
  $$ refresh materialized view concurrently public.player_leaderboard; $$
);

-- Verify
select jobname, schedule, command from cron.job where jobname = 'hallo-amrika-refresh-views';
