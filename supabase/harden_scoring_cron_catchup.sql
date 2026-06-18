-- Harden scoring cron catch-up and leaderboard refresh safety.
--
-- Goals:
--   - Score today's UTC date and yesterday's UTC date with enough retry passes
--     for large matchdays that need scoring_progress resume.
--   - Add a light two-days-ago catch-up so one missed morning window does not
--     strand an older finished date.
--   - Refresh leaderboard_totals/ranks from inside Postgres only when no
--     recent score-day run is mid-resume. This avoids exposing partial score
--     rows if an Edge Function hit WORKER_RESOURCE_LIMIT before completion.

set statement_timeout = '5min';

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

select cron.unschedule('hallo-amrika-score-today')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-today');
select cron.unschedule('hallo-amrika-score-yesterday')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-yesterday');
select cron.unschedule('hallo-amrika-score-two-days-ago')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-score-two-days-ago');
select cron.unschedule('hallo-amrika-refresh-leaderboard')
where exists (select 1 from cron.job where jobname = 'hallo-amrika-refresh-leaderboard');

-- Current UTC date, every 15 minutes for 07:00-09:45 UTC.
select cron.schedule(
  'hallo-amrika-score-today',
  '*/15 7,8,9 * * *',
  $$select private.trigger_score_day((now() at time zone 'utc')::date);$$
);

-- Previous UTC date, staggered 5 minutes later for 07:05-09:50 UTC.
select cron.schedule(
  'hallo-amrika-score-yesterday',
  '5,20,35,50 7,8,9 * * *',
  $$select private.trigger_score_day(((now() at time zone 'utc')::date - 1));$$
);

-- Lightweight catch-up for one missed day. If everything is already scored,
-- score-day returns quickly with already_scored/pending statuses.
select cron.schedule(
  'hallo-amrika-score-two-days-ago',
  '10,25,40,55 9 * * *',
  $$select private.trigger_score_day(((now() at time zone 'utc')::date - 2));$$
);

-- Direct DB refresh after the scoring retry windows. The wrapper skips refresh
-- while any recent date has a nonzero scoring_progress cursor.
select cron.schedule(
  'hallo-amrika-refresh-leaderboard',
  '0,30 10 * * *',
  $$select public.refresh_leaderboard_if_scoring_complete();$$
);

select jobname, schedule, command
from cron.job
where jobname in (
  'hallo-amrika-score-today',
  'hallo-amrika-score-yesterday',
  'hallo-amrika-score-two-days-ago',
  'hallo-amrika-refresh-leaderboard'
)
order by jobname;
