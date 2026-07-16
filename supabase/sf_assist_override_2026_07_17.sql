-- SF manual assist corrections (FIFA free feed logged null assisters).
-- Per user (broadcast/official stats):
--   France 0-2 Spain (07-14): Dani Olmo assisted 1 goal (+1 assist).
--   England 1-2 Argentina (07-15): Lionel Messi assisted BOTH goals (+2 assists).
-- Idempotent: sets breakdown->player->assists to the target and adds only the
-- delta to points. Sourced from current xi_json (SF squad), submitted before SF deadline.
set statement_timeout='5min';
create temporary table tmp_sf_asst(match_date date, name text, nation text, assists int) on commit drop;
insert into tmp_sf_asst values
 ('2026-07-14','OLMO Dani','Spain',1),
 ('2026-07-15','MESSI Lionel','Argentina',2);

create temporary table tmp_sf_asst_elig on commit drop as
select e.id as entry_id, a.match_date, a.name, a.assists as target
from tmp_sf_asst a
join public.entries e on e.league_id='11111111-1111-1111-1111-111111111111'
 and e.submitted_at <= '2026-07-14 19:00:00+00'::timestamptz
cross join lateral jsonb_array_elements(coalesce(e.xi_json,'[]'::jsonb)) x(player)
where x.player->>'name'=a.name and x.player->>'nation'=a.nation
 and not coalesce((x.player->>'wild')::boolean,false)
 and not coalesce((x.player->>'empty')::boolean,false);

-- update existing score rows (owners of a starter who played always have a row)
with existing_add as (
  select s.entry_id, s.match_date,
    jsonb_object_agg(e.name,
      coalesce(s.breakdown->e.name,'{}'::jsonb) || jsonb_build_object('assists', e.target)) as patch,
    sum(e.target - coalesce((s.breakdown->e.name->>'assists')::int,0))::int as added
  from public.scores s
  join tmp_sf_asst_elig e on e.entry_id=s.entry_id and e.match_date=s.match_date
  group by s.entry_id, s.match_date
)
update public.scores s
set breakdown = coalesce(s.breakdown,'{}'::jsonb) || existing_add.patch,
    points = s.points + existing_add.added
from existing_add where s.entry_id=existing_add.entry_id and s.match_date=existing_add.match_date;

-- insert fallback (no pre-existing row for that date; unlikely for a starter)
insert into public.scores(entry_id, match_date, points, breakdown)
select e.entry_id, e.match_date, sum(e.target)::int,
       jsonb_object_agg(e.name, jsonb_build_object('assists', e.target))
from tmp_sf_asst_elig e
where not exists (select 1 from public.scores s where s.entry_id=e.entry_id and s.match_date=e.match_date)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- verify: distinct assist value credited + owner counts per player
select a.name, a.nation, a.match_date, a.assists as target,
   count(*) filter (where (b.value->>'assists') is not null) as owners_with_assist,
   min((b.value->>'assists')::int) as min_val, max((b.value->>'assists')::int) as max_val
from tmp_sf_asst a
join public.scores s on s.match_date=a.match_date
cross join lateral jsonb_each(s.breakdown) b(key,value)
where b.key=a.name and (b.value->>'assists') is not null
group by a.name, a.nation, a.match_date, a.assists order by a.match_date;
