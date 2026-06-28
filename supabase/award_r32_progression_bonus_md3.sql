-- Award R32 progression bonus (+2) to locked MD3 starters.
--
-- Product rule:
--   R32 qualification belongs to the team that got the country through the
--   group stage. Because the R32 transfer window is open, this must use the
--   frozen MD3 squad snapshot (`xi_json_gw3`), not current `xi_json`.
--
-- Idempotent:
--   - only adds `r32: 2` where the player does not already have it
--   - inserts MVP-style score rows only when the player/date has no score row
--   - refreshes player + entry leaderboards/ranks after applying

set statement_timeout = '5min';

create temporary table tmp_r32_qualified_nations (
  nation text primary key
) on commit drop;

insert into tmp_r32_qualified_nations (nation)
select distinct nation
from (
  select home as nation
  from public.matches
  where date >= '2026-06-28'
    and status = 'scheduled'
  union
  select away as nation
  from public.matches
  where date >= '2026-06-28'
    and status = 'scheduled'
) q
where nation is not null;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from tmp_r32_qualified_nations;
  if v_count <> 32 then
    raise exception 'Expected 32 R32 qualified nations, found %', v_count;
  end if;
end;
$$;

create temporary table tmp_md3_fixture_by_nation on commit drop as
select nation, max(match_date) as match_date
from (
  select home as nation, date as match_date
  from public.matches
  where date between '2026-06-24' and '2026-06-28'
    and status = 'finished'
  union all
  select away as nation, date as match_date
  from public.matches
  where date between '2026-06-24' and '2026-06-28'
    and status = 'finished'
) m
group by nation;

do $$
declare
  v_missing text;
begin
  select string_agg(q.nation, ', ' order by q.nation)
    into v_missing
  from tmp_r32_qualified_nations q
  left join tmp_md3_fixture_by_nation md3 on md3.nation = q.nation
  where md3.nation is null;

  if v_missing is not null then
    raise exception 'Missing MD3 fixture date for qualified nations: %', v_missing;
  end if;
end;
$$;

create temporary table tmp_r32_bonus_eligible on commit drop as
select
  e.id as entry_id,
  md3.match_date,
  x.player->>'name' as player_name
from public.entries e
cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw3, e.xi_json)) as x(player)
join tmp_r32_qualified_nations q
  on q.nation = x.player->>'nation'
join tmp_md3_fixture_by_nation md3
  on md3.nation = q.nation
where e.league_id = '11111111-1111-1111-1111-111111111111'
  and e.submitted_at <= '2026-06-24 19:00:00+00'::timestamptz
  and not coalesce((x.player->>'wild')::boolean, false)
  and x.player->>'name' is not null;

create index on tmp_r32_bonus_eligible (entry_id, match_date);

-- Add the R32 bonus to existing score rows. Several players from the same
-- entry can share one MD3 date, so patch all player keys at once.
with existing_add as (
  select
    s.entry_id,
    s.match_date,
    jsonb_object_agg(
      e.player_name,
      coalesce(s.breakdown->e.player_name, '{}'::jsonb)
        || jsonb_build_object('r32', 2)
    ) as patch_breakdown,
    (count(*) * 2)::int as added_points
  from public.scores s
  join tmp_r32_bonus_eligible e
    on e.entry_id = s.entry_id
   and e.match_date = s.match_date
  where coalesce((s.breakdown->e.player_name->>'r32')::int, 0) = 0
  group by s.entry_id, s.match_date
)
update public.scores s
   set breakdown = coalesce(s.breakdown, '{}'::jsonb) || existing_add.patch_breakdown,
       points = s.points + existing_add.added_points
from existing_add
where s.entry_id = existing_add.entry_id
  and s.match_date = existing_add.match_date;

-- Insert R32-only score rows where an eligible player had no MD3 score row
-- on that date.
insert into public.scores (entry_id, match_date, points, breakdown)
select
  e.entry_id,
  e.match_date,
  (count(*) * 2)::int as points,
  jsonb_object_agg(e.player_name, jsonb_build_object('r32', 2)) as breakdown
from tmp_r32_bonus_eligible e
where not exists (
  select 1
  from public.scores s
  where s.entry_id = e.entry_id
    and s.match_date = e.match_date
)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- Verification.
select
  (select count(*) from tmp_r32_qualified_nations) as qualified_nations,
  (select count(*) from tmp_r32_bonus_eligible) as eligible_player_slots,
  coalesce(sum(r32_lines), 0)::int as awarded_player_slots,
  coalesce(sum(r32_points), 0)::int as awarded_points
from (
  select
    count(*) filter (where coalesce((b.value->>'r32')::int, 0) = 2) as r32_lines,
    sum(coalesce((b.value->>'r32')::int, 0)) as r32_points
  from public.scores s
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(key, value)
  where s.match_date between '2026-06-24' and '2026-06-28'
) v;
