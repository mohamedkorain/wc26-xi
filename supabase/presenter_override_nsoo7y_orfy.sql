-- Presenter lineup override: Mohamedalaaorfy@gmail.com / Ya 3otle.
--
-- Why: Mohamed supplied Nsoo7y's presenter lineup and requested it to be
-- applied to this account with the same MD1 treatment as the other presenter
-- overrides.
--
-- Scope:
--   - Only entry 8bf0e040-6920-4a8b-9909-63afca7ca413 / user
--     81ad546e-bf02-4b98-92dd-de20b8e2a6b6
--   - Sets xi_json and xi_json_gw1 to the presenter lineup so historical
--     scoring uses the intended MD1 team.
--   - Rebuilds only this entry's score rows from existing canonical player
--     score breakdowns, then refreshes cached leaderboards/ranks.

set statement_timeout = '5min';

do $$
declare
  v_entry_id uuid := '8bf0e040-6920-4a8b-9909-63afca7ca413';
  v_user_id uuid := '81ad546e-bf02-4b98-92dd-de20b8e2a6b6';
  v_updated int;
  v_inserted_scores int;
  v_xi jsonb := $json$
[
  {"no":1,"tag":"GK","arab":false,"club":"Tractor Sazi Tabriz FC (IRN)","name":"BEIRANVAND Alireza","role":"GK","slot":0,"wild":false,"bucket":"GK_ST","nation":"Iran","category":3,"shirt_name":"BEIRANVAND","nation_code":"IRN","last":"SAFARBEIRANVAND","first":"Ali Reza"},
  {"no":6,"tag":"LCB","arab":false,"club":"Manchester City FC (ENG)","name":"GUEHI Marc","role":"CB","slot":1,"wild":false,"bucket":"DEF","nation":"England","category":1,"shirt_name":"GUEHI","nation_code":"ENG","last":"GUEHI","first":"Addji Keaninkin Marc-Isreal"},
  {"no":4,"tag":"RCB","arab":true,"club":"Pakhtakor Tashkent FK (UZB)","name":"ZAID TAHSEEN","role":"CB","slot":2,"wild":false,"bucket":"DEF","nation":"Iraq","category":5,"shirt_name":"ZAID T.","nation_code":"IRQ","last":"HANTOOSH","first":"Zaid Tahseen Abd Zaid"},
  {"no":3,"tag":"LB","arab":false,"club":"Liverpool FC (ENG)","name":"ROBERTSON Andy","role":"FB","slot":3,"wild":false,"bucket":"DEF","nation":"Scotland","category":5,"shirt_name":"ROBERTSON","nation_code":"SCO","last":"ROBERTSON","first":"Andrew Henry"},
  {"no":12,"tag":"RB","arab":true,"club":"RC Lens (FRA)","name":"SAUD ABDULHAMID","role":"FB","slot":4,"wild":false,"bucket":"DEF","nation":"Saudi Arabia","category":6,"shirt_name":"SAUD","nation_code":"KSA","last":"ABDULHAMID","first":"Saud Abdullah S"},
  {"no":22,"tag":"LCM","arab":false,"club":"FC St. Pauli (GER)","name":"IRVINE Jackson","role":"CM","slot":5,"wild":false,"bucket":"MID","nation":"Australia","category":3,"shirt_name":"IRVINE","nation_code":"AUS","last":"IRVINE","first":"Jackson Alexander"},
  {"no":8,"tag":"RCM","arab":false,"club":"Brighton & Hove Albion FC (ENG)","name":"GOMEZ Diego","role":"CM","slot":6,"wild":false,"bucket":"MID","nation":"Paraguay","category":4,"shirt_name":"D. GOMEZ","nation_code":"PAR","last":"GOMEZ AMARILLA","first":"Diego Alexander"},
  {"no":11,"tag":"LW","arab":false,"club":"Manchester City FC (ENG)","name":"DOKU Jeremy","role":"WIN","slot":7,"wild":false,"bucket":"MID","nation":"Belgium","category":2,"shirt_name":"DOKU","nation_code":"BEL","last":"DOKU","first":"Jeremy Baffour"},
  {"no":10,"tag":"RW","arab":false,"club":"Al Nassr FC (KSA)","name":"MANE Sadio","role":"WIN","slot":8,"wild":false,"bucket":"MID","nation":"Senegal","category":2,"shirt_name":"MAN\u00c9","nation_code":"SEN","last":"MAN\u00c9","first":"Sadio"},
  {"no":10,"tag":"ST","arab":false,"club":"Real Madrid C. F. (ESP)","name":"MBAPPE Kylian","role":"ST","slot":9,"wild":false,"bucket":"GK_ST","nation":"France","category":1,"shirt_name":"MBAPPE","nation_code":"FRA","last":"MBAPPE LOTTIN","first":"Kylian"},
  {"no":9,"tag":"ST","arab":false,"club":"Nottingham Forest FC (ENG)","name":"WOOD Chris","role":"ST","slot":10,"wild":false,"bucket":"GK_ST","nation":"New Zealand","category":6,"shirt_name":"WOOD","nation_code":"NZL","last":"WOOD","first":"Christopher Grant"},
  {"no":12,"tag":"WILD","arab":false,"club":"Villarreal CF (ESP)","name":"OLUWASEYI Tani","role":null,"slot":11,"wild":true,"bucket":"GK_ST","nation":"Canada","category":4,"shirt_name":"OLUWASEYI","nation_code":"CAN","last":"OLUWASEYI","first":"Tanitoluwa Oluwatimilehin"}
]
$json$::jsonb;
begin
  perform public.validate_entry_xi_json(v_xi);

  create temp table nsoo7y_player_scores on commit drop as
  with selected_players as (
    select slot.player->>'name' as player_name
    from jsonb_array_elements(v_xi) as slot(player)
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
     set xi_json = v_xi,
         xi_json_gw1 = v_xi,
         formation = '4-4-2',
         transfers_used = 0
   where id = v_entry_id
     and user_id = v_user_id
     and lower(team_name) = lower('Ya 3otle');

  get diagnostics v_updated = row_count;

  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';

  if v_updated <> 1 then
    raise exception 'Expected to update exactly one Nsoo7y presenter entry, updated %', v_updated;
  end if;

  delete from public.scores
   where entry_id = v_entry_id
     and match_date >= date '2026-06-11';

  with target_starters as (
    select slot.player->>'name' as player_name
    from jsonb_array_elements(v_xi) as slot(player)
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
        - case when ps.stats ? 'red' then 1 else 0 end
      )::int as points
    from target_starters ts
    join nsoo7y_player_scores ps
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
  raise notice 'Nsoo7y presenter override applied: entry rows %, score rows %',
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

select e.id, e.team_name, e.formation, e.transfers_used, lt.total_points, e.rank_current
from public.entries e
left join public.leaderboard_totals lt on lt.entry_id = e.id
where e.id = '8bf0e040-6920-4a8b-9909-63afca7ca413';

select match_date, points, breakdown
from public.scores
where entry_id = '8bf0e040-6920-4a8b-9909-63afca7ca413'
order by match_date;
