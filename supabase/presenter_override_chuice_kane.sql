-- Presenter/admin correction: Chuice.
--
-- Replace WATKINS Ollie with KANE Harry in Chuice's mini-league entry and
-- rebuild only this entry's score rows from existing canonical per-player
-- breakdowns. This keeps the change scoped to one curated presenter entry.

set statement_timeout = '5min';

do $$
declare
  v_entry_id uuid := '06f4870f-9cc9-408e-aa10-b744ab2acf08';
  v_user_id uuid := '0246f66f-a22f-4819-8b95-84d24971a2c5';
  v_new_xi jsonb;
  v_new_xi_gw1 jsonb;
  v_updated int;
  v_inserted_scores int;
  v_watkins_current int;
  v_watkins_gw1 int;
begin
  select count(*) into v_watkins_current
  from public.entries e
  cross join lateral jsonb_array_elements(e.xi_json) as x(player)
  where e.id = v_entry_id
    and e.user_id = v_user_id
    and x.player->>'name' = 'WATKINS Ollie';

  select count(*) into v_watkins_gw1
  from public.entries e
  cross join lateral jsonb_array_elements(e.xi_json_gw1) as x(player)
  where e.id = v_entry_id
    and e.user_id = v_user_id
    and x.player->>'name' = 'WATKINS Ollie';

  if v_watkins_current <> 1 or v_watkins_gw1 <> 1 then
    raise exception 'Expected exactly one Watkins in current and GW1 lineups, found current %, gw1 %',
      v_watkins_current, v_watkins_gw1;
  end if;

  with kane as (
    select *
    from public.player_pool
    where nation = 'England'
      and name = 'KANE Harry'
  )
  select jsonb_agg(
    case
      when x.player->>'name' = 'WATKINS Ollie' then
        x.player || jsonb_build_object(
          'no', kane.no,
          'arab', kane.arab,
          'club', kane.club,
          'name', kane.name,
          'nation', kane.nation,
          'category', kane.category,
          'shirt_name', kane.shirt_name,
          'nation_code', kane.nation_code
        )
      else x.player
    end
    order by x.ord
  )
    into v_new_xi
  from public.entries e
  cross join lateral jsonb_array_elements(e.xi_json) with ordinality as x(player, ord)
  cross join kane
  where e.id = v_entry_id
    and e.user_id = v_user_id;

  with kane as (
    select *
    from public.player_pool
    where nation = 'England'
      and name = 'KANE Harry'
  )
  select jsonb_agg(
    case
      when x.player->>'name' = 'WATKINS Ollie' then
        x.player || jsonb_build_object(
          'no', kane.no,
          'arab', kane.arab,
          'club', kane.club,
          'name', kane.name,
          'nation', kane.nation,
          'category', kane.category,
          'shirt_name', kane.shirt_name,
          'nation_code', kane.nation_code
        )
      else x.player
    end
    order by x.ord
  )
    into v_new_xi_gw1
  from public.entries e
  cross join lateral jsonb_array_elements(e.xi_json_gw1) with ordinality as x(player, ord)
  cross join kane
  where e.id = v_entry_id
    and e.user_id = v_user_id;

  -- Capture canonical player/date score stats before deleting Chuice rows.
  create temp table chuice_player_scores on commit drop as
  with selected_players as (
    select slot.player->>'name' as player_name
    from jsonb_array_elements(v_new_xi) as slot(player)
    where not coalesce((slot.player->>'wild')::boolean, false)
  ),
  sampled as (
    select distinct on (pn.player_name, s.match_date)
      s.match_date,
      pn.player_name,
      pn.stats
    from public.scores s
    cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as pn(player_name, stats)
    join selected_players sp on sp.player_name = pn.player_name
    where s.match_date >= date '2026-06-11'
    order by pn.player_name, s.match_date, s.entry_id
  )
  select *
  from sampled;

  execute 'alter table public.entries disable trigger guard_locked_entry_transfer_trg';

  update public.entries
     set xi_json = v_new_xi,
         xi_json_gw1 = v_new_xi_gw1
   where id = v_entry_id
     and user_id = v_user_id;

  get diagnostics v_updated = row_count;

  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';

  if v_updated <> 1 then
    raise exception 'Expected to update exactly one Chuice entry, updated %', v_updated;
  end if;

  delete from public.scores
   where entry_id = v_entry_id
     and match_date >= date '2026-06-11';

  with target_starters as (
    select slot.player->>'name' as player_name
    from jsonb_array_elements(v_new_xi) as slot(player)
    where not coalesce((slot.player->>'wild')::boolean, false)
  ),
  per_player as (
    select
      ps.match_date,
      ts.player_name,
      ps.stats,
      (
          coalesce((ps.stats->>'win')::int, 0)
        + coalesce((ps.stats->>'full90')::int, 0)
        + coalesce((ps.stats->>'goals')::int, 0)
        + coalesce((ps.stats->>'assists')::int, 0)
        + coalesce((ps.stats->>'cleanSheet')::int, 0)
        + coalesce((ps.stats->>'mvp')::int, 0)
        + coalesce((ps.stats->>'red')::int, 0)
      )::int as points
    from target_starters ts
    join chuice_player_scores ps
      on ps.player_name = ts.player_name
  ),
  by_date as (
    select
      match_date,
      sum(points)::int as points,
      jsonb_object_agg(player_name, stats order by player_name) as breakdown,
      bool_or(stats <> '{}'::jsonb) as has_visible_breakdown
    from per_player
    group by match_date
    having sum(points) <> 0 or bool_or(stats <> '{}'::jsonb)
  )
  insert into public.scores (entry_id, match_date, points, breakdown)
  select v_entry_id, match_date, points, breakdown
  from by_date
  on conflict (entry_id, match_date)
  do update set
    points = excluded.points,
    breakdown = excluded.breakdown;

  get diagnostics v_inserted_scores = row_count;
  raise notice 'Chuice Watkins->Kane correction applied: entry rows %, score rows %',
    v_updated, v_inserted_scores;
exception
  when others then
    begin
      execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
    exception when others then
      null;
    end;
    raise;
end $$;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

select e.id, e.team_name, lt.total_points, e.rank_current
from public.entries e
left join public.leaderboard_totals lt on lt.entry_id = e.id
where e.id = '06f4870f-9cc9-408e-aa10-b744ab2acf08';

select match_date, points, breakdown
from public.scores
where entry_id = '06f4870f-9cc9-408e-aa10-b744ab2acf08'
order by match_date;
