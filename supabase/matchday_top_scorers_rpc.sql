-- Fast top-5 current-matchday leaderboard for the homepage tab.
--
-- The first fast version only aggregated selected calendar-day scores. That
-- was quick, but wrong for the product meaning of "Matchday Top": this tab
-- must rank the full current group matchday/round, just like the overall
-- leaderboard's round-points column.
--
-- The frontend sends the current round's scored fixtures as:
--   [{"nation":"Egypt","db_date":"2026-06-22"}, ...]
-- including roster/fixture aliases (USA/United States, Türkiye/Turkey, etc.).
-- This RPC then:
--   - starts from already-written public.scores rows
--   - uses player_pool to keep only players whose nation belongs to the
--     current-round scored fixture payload
--   - avoids scanning every entry's squad JSON just to return five rows
--   - returns only the top rows needed by the UI

create index if not exists scores_match_date_entry_idx
  on public.scores(match_date, entry_id);

drop function if exists public.matchday_top_scorers(date[], int, uuid);

create or replace function public.matchday_top_scorers(
  p_phase text,
  p_fixtures jsonb,
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
  with fixtures as (
    select distinct
      lower(f.nation) as nation_key,
      f.db_date::date as db_date
    from jsonb_to_recordset(coalesce(p_fixtures, '[]'::jsonb))
      as f(nation text, db_date date)
    where f.nation is not null
      and f.db_date is not null
  ),
  score_lines as (
    select
      s.entry_id,
      p.player_name,
      p.stats
    from fixtures fx
    join public.scores s
      on s.match_date = fx.db_date
    cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb))
      as p(player_name, stats)
    join public.player_pool pp
      on pp.name = p.player_name
     and lower(pp.nation) = fx.nation_key
  ),
  player_points as (
    select
      sl.entry_id,
      sum(
        coalesce((sl.stats->>'win')::int, 0)
        + coalesce((sl.stats->>'full90')::int, 0)
        + coalesce((sl.stats->>'goals')::int, 0)
        + coalesce((sl.stats->>'assists')::int, 0)
        + coalesce((sl.stats->>'cleanSheet')::int, 0)
        + coalesce((sl.stats->>'mvp')::int, 0)
        + coalesce((sl.stats->>'r32')::int, 0)
        + coalesce((sl.stats->>'r16')::int, 0)
        + coalesce((sl.stats->>'qf')::int, 0)
        - case
            when sl.stats ? 'red' then greatest(abs(coalesce((sl.stats->>'red')::int, 0)), 1)
            else 0
          end
      )::int as round_points
    from score_lines sl
    group by sl.entry_id
    having sum(
      coalesce((sl.stats->>'win')::int, 0)
      + coalesce((sl.stats->>'full90')::int, 0)
      + coalesce((sl.stats->>'goals')::int, 0)
      + coalesce((sl.stats->>'assists')::int, 0)
      + coalesce((sl.stats->>'cleanSheet')::int, 0)
      + coalesce((sl.stats->>'mvp')::int, 0)
      + coalesce((sl.stats->>'r32')::int, 0)
      + coalesce((sl.stats->>'r16')::int, 0)
      + coalesce((sl.stats->>'qf')::int, 0)
      - case
          when sl.stats ? 'red' then greatest(abs(coalesce((sl.stats->>'red')::int, 0)), 1)
          else 0
        end
    ) <> 0
  )
  select
    e.id as entry_id,
    e.team_name,
    e.user_id,
    coalesce(pd.display_name, '-') as owner_name,
    pp.round_points,
    coalesce(lt.total_points, 0)::int as total_points
  from player_points pp
  join public.entries e
    on e.id = pp.entry_id
   and e.league_id = p_league_id
  left join public.leaderboard_totals lt on lt.entry_id = e.id
  left join public.profile_displays pd on pd.id = e.user_id
  order by pp.round_points desc, e.submitted_at asc
  limit least(greatest(coalesce(p_limit, 5), 1), 50);
$$;

revoke all on function public.matchday_top_scorers(text, jsonb, int, uuid)
  from public, anon, authenticated;
grant execute on function public.matchday_top_scorers(text, jsonb, int, uuid)
  to anon, authenticated;
