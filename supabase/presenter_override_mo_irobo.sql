-- Presenter lineup override: Mo.irobo@gmail.com / Boca Seniors.
--
-- Why: this is one of the show-presenter teams. The live entry was built via
-- normal user flow/transfers, but Mohamed supplied the presenter lineup image
-- and requested it to score from MD1 like Omar Marei's presenter override.
--
-- Scope:
--   - Only entry a098a535-a561-428b-b978-b1ff413e6683 / user 5e4b1c86-0be3-48ed-aeb0-bc42c7e05845
--   - Keeps the public transfer guard installed; disables only that trigger
--     inside this maintenance statement so entry_nations/ownership triggers
--     still update from the new xi_json.
--   - Rebuilds only this entry's historical score rows from existing scored
--     player breakdowns, then refreshes cached leaderboards/ranks.

do $$
declare
  v_entry_id uuid := 'a098a535-a561-428b-b978-b1ff413e6683';
  v_user_id uuid := '5e4b1c86-0be3-48ed-aeb0-bc42c7e05845';
  v_updated int;
  v_inserted_scores int;
  v_xi jsonb := $json$
[
  {"no":1,"tag":"GK","arab":false,"club":"Liverpool FC (ENG)","name":"ALISSON","role":"GK","slot":0,"wild":false,"bucket":"GK_ST","nation":"Brazil","category":1,"shirt_name":"A. BECKER","nation_code":"BRA","last":"BECKER","first":"\u00c1lisson Rams\u00e9s"},
  {"no":5,"tag":"LCB","arab":false,"club":"FC Internazionale Milano (ITA)","name":"AKANJI Manuel","role":"CB","slot":1,"wild":false,"bucket":"DEF","nation":"Switzerland","category":3,"shirt_name":"AKANJI","nation_code":"SUI","last":"AKANJI","first":"Manuel Obafemi"},
  {"no":5,"tag":"RCB","arab":false,"club":"Villarreal CF (ESP)","name":"LOGAN COSTA","role":"CB","slot":2,"wild":false,"bucket":"DEF","nation":"Cape Verde","category":6,"shirt_name":"LOGAN","nation_code":"CPV","last":"COSTA","first":"Logan Evans"},
  {"no":5,"tag":"LB","arab":false,"club":"Fulham FC (ENG)","name":"ROBINSON Antonee","role":"FB","slot":3,"wild":false,"bucket":"DEF","nation":"United States","category":2,"shirt_name":"A. ROBINSON","nation_code":"USA","last":"ROBINSON","first":"Antonee"},
  {"no":21,"tag":"RB","arab":true,"club":"Borussia Dortmund (GER)","name":"BENSEBAINI Ramy","role":"CB","slot":4,"wild":false,"bucket":"DEF","nation":"Algeria","category":4,"shirt_name":"BENSEBAINI","nation_code":"ALG","last":"BENSEBAINI","first":"Amir Selmane Rami"},
  {"no":14,"tag":"LCM","arab":false,"club":"Al Ittihad Kalba SCC (UAE)","name":"GHODDOS Saman","role":"CM","slot":5,"wild":false,"bucket":"MID","nation":"Iran","category":3,"shirt_name":"GHODDOS","nation_code":"IRN","last":"GHODDOOS","first":"Seyed Saman"},
  {"no":22,"tag":"RCM","arab":false,"club":"West Ham United FC (ENG)","name":"SOUCEK Tomas","role":"CM","slot":6,"wild":false,"bucket":"MID","nation":"Czech Republic","category":5,"shirt_name":"SOU\u010cEK","nation_code":"CZE","last":"SOU\u010cEK","first":"Tom\u00e1\u0161"},
  {"no":10,"tag":"LW","arab":true,"club":"Real Madrid C. F. (ESP)","name":"DIAZ Brahim","role":"WIN","slot":7,"wild":false,"bucket":"MID","nation":"Morocco","category":1,"shirt_name":"BRAHIM","nation_code":"MAR","last":"ABDELKADER D\u00cdAZ","first":"Brahim"},
  {"no":11,"tag":"RW","arab":false,"club":"Manchester City FC (ENG)","name":"SEMENYO Antoine","role":"WIN","slot":8,"wild":false,"bucket":"MID","nation":"Ghana","category":6,"shirt_name":"SEMENYO","nation_code":"GHA","last":"SEMENYO","first":"Antoine Serlom"},
  {"no":7,"tag":"ST","arab":false,"club":"Arsenal FC (ENG)","name":"HAVERTZ Kai","role":"ST","slot":9,"wild":false,"bucket":"GK_ST","nation":"Germany","category":2,"shirt_name":"HAVERTZ","nation_code":"GER","last":"HAVERTZ","first":"Kai Lukas"},
  {"no":9,"tag":"ST","arab":false,"club":"Liverpool FC (ENG)","name":"ISAK Alexander","role":"ST","slot":10,"wild":false,"bucket":"GK_ST","nation":"Sweden","category":4,"shirt_name":"ISAK","nation_code":"SWE","last":"ISAK","first":"Alexander"},
  {"no":10,"tag":"WILD","arab":false,"club":"Esteghlal Tehran FC (IRN)","name":"MASHARIPOV Jaloliddin","role":null,"slot":11,"wild":true,"bucket":"MID","nation":"Uzbekistan","category":5,"shirt_name":"MASHARIPOV","nation_code":"UZB","last":"MASHARIPOV","first":"Jaloliddin"}
]
$json$::jsonb;
begin
  execute 'alter table public.entries disable trigger guard_locked_entry_transfer_trg';

  update public.entries
     set xi_json = v_xi,
         xi_json_gw1 = v_xi,
         transfers_used = 0
   where id = v_entry_id
     and user_id = v_user_id
     and team_name = 'Boca Seniors';

  get diagnostics v_updated = row_count;

  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';

  if v_updated <> 1 then
    raise exception 'Expected to update exactly one Boca Seniors entry, updated %', v_updated;
  end if;

  delete from public.scores
   where entry_id = v_entry_id
     and match_date >= date '2026-06-11';

  with selected_players(player_name) as (
    values
      ('ALISSON'),
      ('AKANJI Manuel'),
      ('LOGAN COSTA'),
      ('ROBINSON Antonee'),
      ('BENSEBAINI Ramy'),
      ('GHODDOS Saman'),
      ('SOUCEK Tomas'),
      ('DIAZ Brahim'),
      ('SEMENYO Antoine'),
      ('HAVERTZ Kai'),
      ('ISAK Alexander')
  ),
  sampled_player_scores as (
    select distinct on (pn.player_name, s.match_date)
      s.match_date,
      pn.player_name,
      pn.stats
    from public.scores s
    cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as pn(player_name, stats)
    join selected_players sp on sp.player_name = pn.player_name
    where s.match_date >= date '2026-06-11'
    order by pn.player_name, s.match_date, s.entry_id
  ),
  per_player as (
    select
      match_date,
      player_name,
      stats,
      (
          coalesce((stats->>'win')::int, 0)
        + coalesce((stats->>'full90')::int, 0)
        + coalesce((stats->>'goals')::int, 0)
        + coalesce((stats->>'assists')::int, 0)
        + coalesce((stats->>'cleanSheet')::int, 0)
        + coalesce((stats->>'mvp')::int, 0)
        - case when stats ? 'red' then 1 else 0 end
      )::int as points
    from sampled_player_scores
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
  raise notice 'Boca Seniors presenter override applied: entry rows %, score rows %',
    v_updated, v_inserted_scores;
end $$;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

select e.id, e.team_name, e.transfers_used, lt.total_points, e.rank_current
from public.entries e
left join public.leaderboard_totals lt on lt.entry_id = e.id
where e.id = 'a098a535-a561-428b-b978-b1ff413e6683';

select match_date, points, breakdown
from public.scores
where entry_id = 'a098a535-a561-428b-b978-b1ff413e6683'
order by match_date;
