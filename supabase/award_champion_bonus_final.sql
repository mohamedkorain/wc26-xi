-- World Champion bonus: champion:5 per Final-squad real starter of the winning
-- nation (Spain). Source squad: current xi_json (the Final squad; Final window
-- closed 2026-07-19 19:00 UTC). Eligibility: submitted before the Final deadline.
-- Booked on the Final match_date. Bonus ladder: R32=2,R16=2,QF=3,SF=4,Final=4,champion=5.
set statement_timeout='5min';
create temporary table tmp_champ(nation text primary key, match_date date not null) on commit drop;
insert into tmp_champ values ('Spain','2026-07-19');

create temporary table tmp_champ_elig on commit drop as
select e.id as entry_id, q.match_date, x.player->>'name' as player_name
from public.entries e
cross join lateral jsonb_array_elements(coalesce(e.xi_json,'[]'::jsonb)) x(player)
join tmp_champ q on q.nation = x.player->>'nation'
where e.league_id='11111111-1111-1111-1111-111111111111'
  and e.submitted_at <= '2026-07-19 19:00:00+00'::timestamptz
  and not coalesce((x.player->>'wild')::boolean,false)
  and not coalesce((x.player->>'empty')::boolean,false)
  and x.player->>'name' is not null;
create index on tmp_champ_elig(entry_id, match_date);

with existing_add as (
  select s.entry_id, s.match_date,
    jsonb_object_agg(e.player_name, coalesce(s.breakdown->e.player_name,'{}'::jsonb) || jsonb_build_object('champion',5)) as patch,
    (count(*)*5)::int as added
  from public.scores s
  join tmp_champ_elig e on e.entry_id=s.entry_id and e.match_date=s.match_date
  where coalesce((s.breakdown->e.player_name->>'champion')::int,0)=0
  group by s.entry_id, s.match_date
)
update public.scores s set breakdown = coalesce(s.breakdown,'{}'::jsonb) || existing_add.patch, points = s.points + existing_add.added
from existing_add where s.entry_id=existing_add.entry_id and s.match_date=existing_add.match_date;

insert into public.scores(entry_id, match_date, points, breakdown)
select e.entry_id, e.match_date, (count(*)*5)::int, jsonb_object_agg(e.player_name, jsonb_build_object('champion',5))
from tmp_champ_elig e
where not exists (select 1 from public.scores s where s.entry_id=e.entry_id and s.match_date=e.match_date)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();
select (select count(*) from tmp_champ_elig) as eligible_slots,
       (select coalesce(sum((b.value->>'champion')::int),0) from public.scores s cross join lateral jsonb_each(s.breakdown) b(key,value) where s.match_date='2026-07-19' and (b.value->>'champion') is not null) as champion_points;
