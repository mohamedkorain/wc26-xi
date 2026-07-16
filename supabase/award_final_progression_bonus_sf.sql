-- Final qualification bonus: final:4 per SF-squad real starter whose nation
-- advanced to the FINAL. Source squad: current xi_json (the SF squad; SF window
-- closed 2026-07-14 19:00 UTC). Eligibility: submitted before the SF deadline.
-- Booked on the SF match_date the nation qualified through.
-- Bonus ladder: R32=2, R16=2, QF=3, SF=4, FINAL=4, champion=5.
set statement_timeout='5min';
create temporary table tmp_final_nations(nation text primary key, match_date date not null) on commit drop;
insert into tmp_final_nations values
 ('Spain','2026-07-14'),('Argentina','2026-07-15');

create temporary table tmp_final_eligible on commit drop as
select e.id as entry_id, q.match_date, x.player->>'name' as player_name
from public.entries e
cross join lateral jsonb_array_elements(coalesce(e.xi_json,'[]'::jsonb)) x(player)
join tmp_final_nations q on q.nation = x.player->>'nation'
where e.league_id='11111111-1111-1111-1111-111111111111'
  and e.submitted_at <= '2026-07-14 19:00:00+00'::timestamptz
  and not coalesce((x.player->>'wild')::boolean,false)
  and not coalesce((x.player->>'empty')::boolean,false)
  and x.player->>'name' is not null;
create index on tmp_final_eligible(entry_id, match_date);

with existing_add as (
  select s.entry_id, s.match_date,
    jsonb_object_agg(e.player_name, coalesce(s.breakdown->e.player_name,'{}'::jsonb) || jsonb_build_object('final',4)) as patch,
    (count(*)*4)::int as added
  from public.scores s
  join tmp_final_eligible e on e.entry_id=s.entry_id and e.match_date=s.match_date
  where coalesce((s.breakdown->e.player_name->>'final')::int,0)=0
  group by s.entry_id, s.match_date
)
update public.scores s set breakdown = coalesce(s.breakdown,'{}'::jsonb) || existing_add.patch, points = s.points + existing_add.added
from existing_add where s.entry_id=existing_add.entry_id and s.match_date=existing_add.match_date;

insert into public.scores(entry_id, match_date, points, breakdown)
select e.entry_id, e.match_date, (count(*)*4)::int, jsonb_object_agg(e.player_name, jsonb_build_object('final',4))
from tmp_final_eligible e
where not exists (select 1 from public.scores s where s.entry_id=e.entry_id and s.match_date=e.match_date)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();
select (select count(*) from tmp_final_eligible) as eligible_slots,
       (select coalesce(sum((b.value->>'final')::int),0) from public.scores s cross join lateral jsonb_each(s.breakdown) b(key,value) where s.match_date between '2026-07-14' and '2026-07-15' and (b.value->>'final') is not null) as final_points;
