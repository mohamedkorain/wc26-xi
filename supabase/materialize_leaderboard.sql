-- Materialize leaderboard_totals.
--
-- Why: at 73k entries × ~9 scores each, every leaderboard page-load was
-- aggregating ~657k rows from scratch (regular view = inline SELECT). That
-- spiked CPU into the red AND made refresh_entry_ranks slow enough to
-- hit PostgREST's hard 8s timeout.
--
-- With this materialization:
--   - leaderboard page-load is a flat indexed SELECT
--   - refresh_entry_ranks finishes in <1s
--   - refresh runs once after each score-day completion
--
-- Trade-off: leaderboard is stale until the next score-day refresh. That's
-- fine — points only change when matches are scored, which is what triggers
-- the refresh anyway.

-- 1) Drop the regular view, create a materialized version
drop view if exists public.leaderboard_totals cascade;

create materialized view public.leaderboard_totals as
select
  e.id                              as entry_id,
  e.league_id,
  e.team_name,
  e.formation,
  e.user_id,
  e.submitted_at,
  coalesce(sum(s.points), 0)::int   as total_points
from public.entries e
left join public.scores s on s.entry_id = e.id
group by e.id;

-- Required for REFRESH CONCURRENTLY
create unique index leaderboard_totals_entry_id_uidx
  on public.leaderboard_totals(entry_id);

-- Fast leaderboard sort
create index leaderboard_totals_league_points_idx
  on public.leaderboard_totals(league_id, total_points desc, submitted_at asc);

grant select on public.leaderboard_totals to anon, authenticated;

-- 2) Refresher RPC — non-blocking refresh + immediate rank recompute
create or replace function public.refresh_leaderboard_and_ranks()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.leaderboard_totals;
  perform public.refresh_entry_ranks();
end;
$$;

revoke all on function public.refresh_leaderboard_and_ranks()
  from public, anon, authenticated;

-- 3) Initial population + initial rank seed
refresh materialized view public.leaderboard_totals;
select public.refresh_entry_ranks();
