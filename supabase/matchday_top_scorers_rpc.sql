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
--   - picks the correct squad snapshot for p_phase
--   - counts only non-wildcard starters
--   - matches each player to their current-round fixture date
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
  entry_squads as (
    select
      e.id,
      e.team_name,
      e.user_id,
      e.submitted_at,
      case
        when p_phase = 'gw1' then coalesce(e.xi_json_gw1, e.xi_json, '[]'::jsonb)
        when p_phase = 'gw2' then coalesce(e.xi_json_gw2, '[]'::jsonb)
        else coalesce(e.xi_json, '[]'::jsonb)
      end as squad
    from public.entries e
    where e.league_id = p_league_id
  ),
  entry_players as (
    select
      es.id as entry_id,
      es.team_name,
      es.user_id,
      es.submitted_at,
      player->>'name' as player_name,
      lower(player->>'nation') as nation_key
    from entry_squads es
    cross join lateral jsonb_array_elements(es.squad) as p(player)
    where coalesce((player->>'wild')::boolean, false) = false
      and player->>'name' is not null
      and player->>'nation' is not null
  ),
  player_points as (
    select
      ep.entry_id,
      sum(
        coalesce((st.line->>'win')::int, 0)
        + coalesce((st.line->>'full90')::int, 0)
        + coalesce((st.line->>'goals')::int, 0)
        + coalesce((st.line->>'assists')::int, 0)
        + coalesce((st.line->>'cleanSheet')::int, 0)
        + coalesce((st.line->>'mvp')::int, 0)
        - case
            when st.line ? 'red' then greatest(abs(coalesce((st.line->>'red')::int, 0)), 1)
            else 0
          end
      )::int as round_points
    from entry_players ep
    join fixtures fx
      on fx.nation_key = ep.nation_key
    join public.scores s
      on s.entry_id = ep.entry_id
     and s.match_date = fx.db_date
    cross join lateral (
      select s.breakdown -> ep.player_name as line
    ) st
    where st.line is not null
    group by ep.entry_id
    having sum(
      coalesce((st.line->>'win')::int, 0)
      + coalesce((st.line->>'full90')::int, 0)
      + coalesce((st.line->>'goals')::int, 0)
      + coalesce((st.line->>'assists')::int, 0)
      + coalesce((st.line->>'cleanSheet')::int, 0)
      + coalesce((st.line->>'mvp')::int, 0)
      - case
          when st.line ? 'red' then greatest(abs(coalesce((st.line->>'red')::int, 0)), 1)
          else 0
        end
    ) <> 0
  )
  select
    es.id as entry_id,
    es.team_name,
    es.user_id,
    coalesce(pd.display_name, '-') as owner_name,
    pp.round_points,
    coalesce(lt.total_points, 0)::int as total_points
  from player_points pp
  join entry_squads es on es.id = pp.entry_id
  left join public.leaderboard_totals lt on lt.entry_id = es.id
  left join public.profile_displays pd on pd.id = es.user_id
  order by pp.round_points desc, es.submitted_at asc
  limit least(greatest(coalesce(p_limit, 5), 1), 50);
$$;

revoke all on function public.matchday_top_scorers(text, jsonb, int, uuid)
  from public, anon, authenticated;
grant execute on function public.matchday_top_scorers(text, jsonb, int, uuid)
  to anon, authenticated;
