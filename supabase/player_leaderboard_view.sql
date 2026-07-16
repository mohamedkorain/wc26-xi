-- Materialized version of the per-player tournament leaderboard.
-- Was a regular view → re-aggregated ~37k score rows on every homepage load,
-- which is what spiked DB CPU. Now it's cached; refreshed by score-day after
-- each scoring run via the refresh_player_leaderboard() RPC below.

drop materialized view if exists public.player_leaderboard;
drop view if exists public.player_leaderboard;

create materialized view public.player_leaderboard as
with unnested as (
  select s.match_date, pn.player_name, pn.stats
  from public.scores s
  cross join lateral jsonb_each(s.breakdown) as pn(player_name, stats)
),
deduped as (
  select distinct on (player_name, match_date)
    player_name, match_date, stats
  from unnested
)
select
  player_name,
  count(*)::int                                       as matches,
  coalesce(sum((stats->>'goals')::int), 0)::int      as goals,
  coalesce(sum((stats->>'assists')::int), 0)::int    as assists,
  coalesce(sum((stats->>'cleanSheet')::int), 0)::int as clean_sheets,
  coalesce(sum((stats->>'mvp')::int), 0)::int        as mvps,
  coalesce(sum(case when stats->>'red' is not null then 1 else 0 end), 0)::int as reds,
  sum(
      coalesce((stats->>'win')::int, 0)
    + coalesce((stats->>'full90')::int, 0)
    + coalesce((stats->>'goals')::int, 0)
    + coalesce((stats->>'assists')::int, 0)
    + coalesce((stats->>'cleanSheet')::int, 0)
    + coalesce((stats->>'mvp')::int, 0)
    + coalesce((stats->>'r32')::int, 0)
    + coalesce((stats->>'r16')::int, 0)
    + coalesce((stats->>'qf')::int, 0)
    + coalesce((stats->>'sf')::int, 0)
    + coalesce((stats->>'final')::int, 0)
    + coalesce((stats->>'champion')::int, 0)
    - case when stats->>'red' is not null then 1 else 0 end
  )::int as total_points
from deduped
group by player_name
order by total_points desc, goals desc, assists desc;

-- Required by REFRESH ... CONCURRENTLY
create unique index if not exists player_leaderboard_pname_idx
  on public.player_leaderboard(player_name);

grant select on public.player_leaderboard to anon, authenticated;

-- RPC the Edge Function calls after scoring to keep the cache fresh.
-- SECURITY DEFINER so the anon role can't refresh — only service_role.
create or replace function public.refresh_player_leaderboard()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.player_leaderboard;
end;
$$;

revoke all on function public.refresh_player_leaderboard() from public, anon, authenticated;

-- Initial populate
refresh materialized view public.player_leaderboard;
