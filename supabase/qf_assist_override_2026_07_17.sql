-- QF manual assist corrections. FIFA's free feed logged null assisters for all
-- QF goals, so no assist points were credited. Source: official WC26 QF Most
-- Assists list (user-provided). Each player +1 assist on their QF match_date.
--   07-09 France 2-0 Morocco: Mbappe, Doue
--   07-10 Spain 2-1 Belgium: Castagne (BEL)
--   07-11 Norway 1-2 England: Gordon (ENG), Odegaard (NOR)
--   07-11 Argentina 3-1 Switzerland: Lopez, Messi (ARG), Rodriguez (SUI)
-- Source squad = FROZEN xi_json_qf (the QF squad; current xi_json is now the SF
-- squad, so it would credit the wrong owners). Idempotent: sets assists to the
-- target and adds only the delta to points.
set statement_timeout='5min';
create temporary table tmp_qf_asst(match_date date, name text, nation text, assists int) on commit drop;
insert into tmp_qf_asst values
 ('2026-07-09','MBAPPE Kylian','France',1),
 ('2026-07-09','DOUE Desire','France',1),
 ('2026-07-10','CASTAGNE Timothy','Belgium',1),
 ('2026-07-11','GORDON Anthony','England',1),
 ('2026-07-11','ODEGAARD Martin','Norway',1),
 ('2026-07-11','LOPEZ Jose Manuel','Argentina',1),
 ('2026-07-11','MESSI Lionel','Argentina',1),
 ('2026-07-11','RODRIGUEZ Ricardo','Switzerland',1);

create temporary table tmp_qf_asst_elig on commit drop as
select e.id as entry_id, a.match_date, a.name, a.assists as target
from tmp_qf_asst a
join public.entries e on e.league_id='11111111-1111-1111-1111-111111111111'
 and e.submitted_at <= '2026-07-09 19:00:00+00'::timestamptz
cross join lateral jsonb_array_elements(coalesce(e.xi_json_qf, e.xi_json,'[]'::jsonb)) x(player)
where x.player->>'name'=a.name and x.player->>'nation'=a.nation
 and not coalesce((x.player->>'wild')::boolean,false)
 and not coalesce((x.player->>'empty')::boolean,false);
create index on tmp_qf_asst_elig(entry_id, match_date);

-- update existing score rows (create the player's key if absent; add only delta)
with existing_add as (
  select s.entry_id, s.match_date,
    jsonb_object_agg(e.name,
      coalesce(s.breakdown->e.name,'{}'::jsonb) || jsonb_build_object('assists', e.target)) as patch,
    sum(e.target - coalesce((s.breakdown->e.name->>'assists')::int,0))::int as added
  from public.scores s
  join tmp_qf_asst_elig e on e.entry_id=s.entry_id and e.match_date=s.match_date
  group by s.entry_id, s.match_date
)
update public.scores s
set breakdown = coalesce(s.breakdown,'{}'::jsonb) || existing_add.patch,
    points = s.points + existing_add.added
from existing_add where s.entry_id=existing_add.entry_id and s.match_date=existing_add.match_date;

-- insert fallback: owner had this player as a QF starter but no score row on that
-- date (e.g. a losing-side assister with zero other points).
insert into public.scores(entry_id, match_date, points, breakdown)
select e.entry_id, e.match_date, sum(e.target)::int,
       jsonb_object_agg(e.name, jsonb_build_object('assists', e.target))
from tmp_qf_asst_elig e
where not exists (select 1 from public.scores s where s.entry_id=e.entry_id and s.match_date=e.match_date)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- verify: owner counts + value consistency per player
select a.name, a.nation, a.match_date,
   count(*) filter (where (b.value->>'assists') is not null) as owners_with_assist,
   min((b.value->>'assists')::int) as min_val, max((b.value->>'assists')::int) as max_val
from tmp_qf_asst a
join public.scores s on s.match_date=a.match_date
cross join lateral jsonb_each(s.breakdown) b(key,value)
where b.key=a.name and (b.value->>'assists') is not null
group by a.name, a.nation, a.match_date order by a.match_date, a.name;
