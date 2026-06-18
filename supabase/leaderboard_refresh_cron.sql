-- Guarded direct database refresh after the morning scoring window.
--
-- Why: score-day runs as an Edge Function and calls RPCs through PostgREST.
-- Long leaderboard materialized-view refreshes can exceed PostgREST's request
-- timeout, leaving leaderboard_totals stale even when raw scores are correct.
--
-- This pg_cron job runs inside Postgres, so it can refresh the leaderboard
-- cache/ranks directly after the normal Cairo scoring window has ended.
-- It skips while score-day has a nonzero scoring_progress cursor so partial
-- score rows are not exposed if an Edge Function hits WORKER_RESOURCE_LIMIT.

create extension if not exists pg_cron;

create or replace function public.refresh_leaderboard_if_scoring_complete(
  p_since date default (((now() at time zone 'utc')::date - 3))
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pending record;
begin
  select match_date, offset_
    into pending
  from public.scoring_progress
  where match_date >= p_since
    and offset_ > 0
  order by match_date
  limit 1;

  if found then
    return format(
      'skipped: scoring still in progress for %s at offset %s',
      pending.match_date,
      pending.offset_
    );
  end if;

  perform public.refresh_leaderboard_and_ranks();
  return 'refreshed';
end;
$$;

revoke all on function public.refresh_leaderboard_if_scoring_complete(date)
  from public, anon, authenticated;

select cron.unschedule('hallo-amrika-refresh-leaderboard')
where exists (
  select 1
  from cron.job
  where jobname = 'hallo-amrika-refresh-leaderboard'
);

-- 10:00 and 10:30 UTC = 13:00/13:30 Cairo during the tournament window.
-- Scoring jobs run 07:00-09:55 UTC, so this lands after all retry passes.
select cron.schedule(
  'hallo-amrika-refresh-leaderboard',
  '0,30 10 * * *',
  $$select public.refresh_leaderboard_if_scoring_complete();$$
);

select jobname, schedule, command
from cron.job
where jobname = 'hallo-amrika-refresh-leaderboard';
