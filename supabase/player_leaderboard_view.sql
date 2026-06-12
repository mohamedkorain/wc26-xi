-- Pre-aggregated per-player tournament totals.
-- Avoids 37+ paginated requests from the browser; a single SELECT from this
-- view is < 50ms and returns the top scorers ready to render.

create or replace view public.player_leaderboard as
with unnested as (
  -- Expand scores.breakdown jsonb (keyed by player name) into rows.
  select
    s.match_date,
    pn.player_name,
    pn.stats
  from public.scores s
  cross join lateral jsonb_each(s.breakdown) as pn(player_name, stats)
),
deduped as (
  -- Each player's stats for a given match are identical across every entry
  -- that picked them — keep one row per (player, match).
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
    - case when stats->>'red' is not null then 1 else 0 end
  )::int as total_points
from deduped
group by player_name
order by total_points desc, goals desc, assists desc;

grant select on public.player_leaderboard to anon, authenticated;
