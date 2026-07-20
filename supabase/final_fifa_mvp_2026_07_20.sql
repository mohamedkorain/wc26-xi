-- Final FIFA official Player of the Match (+1 mvp): Ferran Torres (Spain),
-- scorer of the 106' winner in Spain 1-0 Argentina (AET). Source: current
-- xi_json (Final squad), submitted before the Final deadline.
set statement_timeout='5min';
create temporary table tmp_fin_mvp(match_date date, name text, nation text) on commit drop;
insert into tmp_fin_mvp values ('2026-07-19','TORRES Ferran','Spain');

create temporary table tmp_fin_mvp_elig on commit drop as
select e.id as entry_id, m.match_date, m.name
from tmp_fin_mvp m
join public.entries e on e.league_id='11111111-1111-1111-1111-111111111111'
 and e.submitted_at <= '2026-07-19 19:00:00+00'::timestamptz
cross join lateral jsonb_array_elements(coalesce(e.xi_json,'[]'::jsonb)) x(player)
where x.player->>'name'=m.name and x.player->>'nation'=m.nation
 and not coalesce((x.player->>'wild')::boolean,false)
 and not coalesce((x.player->>'empty')::boolean,false);

with existing_add as (
  select s.entry_id, s.match_date,
    jsonb_object_agg(e.name, coalesce(s.breakdown->e.name,'{}'::jsonb) || jsonb_build_object('mvp',1)) as patch,
    count(*)::int as added
  from public.scores s
  join tmp_fin_mvp_elig e on e.entry_id=s.entry_id and e.match_date=s.match_date
  where coalesce((s.breakdown->e.name->>'mvp')::int,0)=0
  group by s.entry_id, s.match_date
)
update public.scores s set breakdown = coalesce(s.breakdown,'{}'::jsonb) || existing_add.patch, points = s.points + existing_add.added
from existing_add where s.entry_id=existing_add.entry_id and s.match_date=existing_add.match_date;

insert into public.scores(entry_id, match_date, points, breakdown)
select e.entry_id, e.match_date, count(*)::int, jsonb_object_agg(e.name, jsonb_build_object('mvp',1))
from tmp_fin_mvp_elig e
where not exists (select 1 from public.scores s where s.entry_id=e.entry_id and s.match_date=e.match_date)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();
select m.name, m.nation, count(*) filter (where (b.value->>'mvp') is not null) as mvp_owner_rows
from tmp_fin_mvp m
join public.scores s on s.match_date=m.match_date
cross join lateral jsonb_each(s.breakdown) b(key,value)
where b.key=m.name and (b.value->>'mvp') is not null
group by m.name, m.nation;
