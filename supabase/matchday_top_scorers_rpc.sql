-- Fast top-5 matchday leaderboard for the homepage tab.
--
-- The old frontend downloaded every scores row for the current matchday,
-- grouped/sorted them in the browser, then kept only five rows. At 70k+
-- entries this was slow even though the UI only showed five teams.
--
-- This RPC keeps the aggregation inside Postgres and returns only the rows
-- needed by the UI. The index makes date-based score aggregation cheap.

create index if not exists scores_match_date_entry_idx
  on public.scores(match_date, entry_id);

create or replace function public.matchday_top_scorers(
  p_dates date[],
  p_limit int default 5,
  p_league_id uuid default '11111111-1111-1111-1111-111111111111'
)
returns table (
  entry_id uuid,
  team_name text,
  user_id uuid,
  owner_name text,
  round_points int,
  total_points int
)
language sql
stable
security definer
set search_path = public
as $$
  with entry_points as (
    select
      s.entry_id,
      sum(s.points)::int as round_points
    from public.scores s
    where p_dates is not null
      and array_length(p_dates, 1) > 0
      and s.match_date = any(p_dates)
    group by s.entry_id
    having sum(s.points) <> 0
  )
  select
    e.id as entry_id,
    e.team_name,
    e.user_id,
    coalesce(pd.display_name, '—') as owner_name,
    ep.round_points,
    coalesce(lt.total_points, 0)::int as total_points
  from entry_points ep
  join public.entries e on e.id = ep.entry_id
  left join public.leaderboard_totals lt on lt.entry_id = e.id
  left join public.profile_displays pd on pd.id = e.user_id
  where e.league_id = p_league_id
  order by ep.round_points desc, e.submitted_at asc
  limit least(greatest(coalesce(p_limit, 5), 1), 50);
$$;

revoke all on function public.matchday_top_scorers(date[], int, uuid)
  from public, anon, authenticated;
grant execute on function public.matchday_top_scorers(date[], int, uuid)
  to anon, authenticated;
