-- Full R32 FIFA MVP cleanup + R16 progression bonus.
--
-- Source of truth: FIFA official Michelob Ultra Superior Player of the Match
-- list supplied on 2026-07-05.
--
-- Product rules:
--   - R32 MVP points belong to the locked R32 scoring squad.
--   - R16 progression (+2) belongs to the players who advanced from R32,
--     therefore it also uses the frozen R32 squad snapshot (`xi_json_r32`).
--   - R16 transfer edits must not affect already-earned R32/R16-qualification
--     points.
--
-- Idempotent:
--   - removes stale MVP flags from non-official players in the same fixture
--   - awards missing official MVP flags once
--   - awards missing `r16: 2` progression flags once
--   - refreshes cached leaderboards/ranks

set statement_timeout = '5min';

create temporary table tmp_r32_fifa_mvp (
  external_id text primary key,
  match_date date not null,
  home_nation text not null,
  away_nation text not null,
  player_name text not null,
  player_nation text not null
) on commit drop;

insert into tmp_r32_fifa_mvp
  (external_id, match_date, home_nation, away_nation, player_name, player_nation)
values
  ('1561329', '2026-06-28', 'South Africa', 'Canada', 'EUSTAQUIO Stephen', 'Canada'),
  ('1565176', '2026-06-29', 'Germany', 'Paraguay', 'GILL Orlando', 'Paraguay'),
  ('1562345', '2026-06-30', 'Netherlands', 'Morocco', 'DIOP Issa', 'Morocco'),
  ('1562344', '2026-06-29', 'Brazil', 'Japan', 'CASEMIRO', 'Brazil'),
  ('1565177', '2026-06-30', 'France', 'Sweden', 'MBAPPE Kylian', 'France'),
  ('1564789', '2026-06-30', 'Ivory Coast', 'Norway', 'NUSA Antonio', 'Norway'),
  ('1567306', '2026-07-01', 'Mexico', 'Ecuador', 'QUINONES Julian', 'Mexico'),
  ('1567307', '2026-07-01', 'England', 'DR Congo', 'KANE Harry', 'England'),
  ('1562586', '2026-07-02', 'United States', 'Bosnia and Herzegovina', 'TILLMAN Malik', 'United States'),
  ('1567308', '2026-07-01', 'Belgium', 'Senegal', 'TIELEMANS Youri', 'Belgium'),
  ('1567309', '2026-07-02', 'Portugal', 'Croatia', 'CRISTIANO RONALDO', 'Portugal'),
  ('1567311', '2026-07-02', 'Spain', 'Austria', 'YAMAL Lamine', 'Spain'),
  ('1567312', '2026-07-03', 'Switzerland', 'Algeria', 'EMBOLO Breel', 'Switzerland'),
  ('1565179', '2026-07-03', 'Argentina', 'Cape Verde', 'MESSI Lionel', 'Argentina'),
  ('1567310', '2026-07-04', 'Colombia', 'Ghana', 'DIAZ Luis', 'Colombia'),
  ('1565178', '2026-07-03', 'Australia', 'Egypt', 'MOHAMED SALAH', 'Egypt');

do $$
declare
  v_missing text;
begin
  select string_agg(m.external_id || ':' || m.player_name || ' (' || m.player_nation || ')', ', ')
    into v_missing
  from tmp_r32_fifa_mvp m
  left join public.player_pool pp
    on pp.name = m.player_name
   and pp.nation = m.player_nation
  where pp.name is null;

  if v_missing is not null then
    raise exception 'Missing MVP player_pool rows: %', v_missing;
  end if;
end;
$$;

do $$
declare
  v_missing text;
begin
  select string_agg(m.external_id || ':' || m.home_nation || '-' || m.away_nation, ', ')
    into v_missing
  from tmp_r32_fifa_mvp m
  left join public.matches mt
    on mt.external_id = m.external_id
   and mt.date = m.match_date
   and mt.home = m.home_nation
   and mt.away = m.away_nation
   and mt.status = 'finished'
  where mt.external_id is null;

  if v_missing is not null then
    raise exception 'Missing/unfinished R32 match rows: %', v_missing;
  end if;
end;
$$;

create temporary table tmp_r32_fixture_player_names on commit drop as
select distinct
  m.external_id,
  m.match_date,
  pp.name
from tmp_r32_fifa_mvp m
join public.player_pool pp
  on pp.nation in (m.home_nation, m.away_nation);

-- Remove stale MVP flags from non-official players in the same fixture.
with expanded as (
  select
    s.entry_id,
    s.match_date,
    b.key as player_name,
    b.value as detail,
    m.player_name as official_player_name,
    fpn.name is not null as is_fixture_player
  from public.scores s
  join tmp_r32_fifa_mvp m
    on m.match_date = s.match_date
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(key, value)
  left join tmp_r32_fixture_player_names fpn
    on fpn.external_id = m.external_id
   and fpn.match_date = s.match_date
   and fpn.name = b.key
),
transformed as (
  select
    entry_id,
    match_date,
    player_name,
    case
      when bool_or(
        is_fixture_player
        and player_name <> official_player_name
        and coalesce((detail->>'mvp')::int, 0) <> 0
      )
      then detail - 'mvp'
      else detail
    end as new_detail,
    case
      when bool_or(
        is_fixture_player
        and player_name <> official_player_name
        and coalesce((detail->>'mvp')::int, 0) <> 0
      )
      then coalesce((detail->>'mvp')::int, 0)
      else 0
    end as removed_points
  from expanded
  group by entry_id, match_date, player_name, detail
),
rebuilt as (
  select
    entry_id,
    match_date,
    coalesce(
      jsonb_object_agg(player_name, new_detail) filter (where new_detail <> '{}'::jsonb),
      '{}'::jsonb
    ) as new_breakdown,
    sum(removed_points)::int as removed_points
  from transformed
  group by entry_id, match_date
  having sum(removed_points) > 0
)
update public.scores s
   set breakdown = rebuilt.new_breakdown,
       points = greatest(0, s.points - rebuilt.removed_points)
from rebuilt
where s.entry_id = rebuilt.entry_id
  and s.match_date = rebuilt.match_date;

-- Eligible official MVP owners: entries locked before R32 kickoff with the
-- official player in the frozen R32 starting XI.
create temporary table tmp_r32_official_mvp_eligible on commit drop as
select distinct
  e.id as entry_id,
  m.match_date,
  m.player_name
from tmp_r32_fifa_mvp m
join public.entries e
  on e.league_id = '11111111-1111-1111-1111-111111111111'
 and e.submitted_at <= '2026-06-28 19:00:00+00'::timestamptz
cross join lateral jsonb_array_elements(coalesce(e.xi_json_r32, e.xi_json, '[]'::jsonb)) as x(player)
where not coalesce((x.player->>'wild')::boolean, false)
  and not coalesce((x.player->>'empty')::boolean, false)
  and x.player->>'name' = m.player_name
  and x.player->>'nation' = m.player_nation;

with existing_add as (
  select
    s.entry_id,
    s.match_date,
    jsonb_object_agg(
      e.player_name,
      coalesce(s.breakdown->e.player_name, '{}'::jsonb) || jsonb_build_object('mvp', 1)
    ) as patch_breakdown,
    count(*)::int as added_points
  from public.scores s
  join tmp_r32_official_mvp_eligible e
    on e.entry_id = s.entry_id
   and e.match_date = s.match_date
  where coalesce((s.breakdown->e.player_name->>'mvp')::int, 0) = 0
  group by s.entry_id, s.match_date
)
update public.scores s
   set breakdown = coalesce(s.breakdown, '{}'::jsonb) || existing_add.patch_breakdown,
       points = s.points + existing_add.added_points
from existing_add
where s.entry_id = existing_add.entry_id
  and s.match_date = existing_add.match_date;

insert into public.scores (entry_id, match_date, points, breakdown)
select
  e.entry_id,
  e.match_date,
  count(*)::int,
  jsonb_object_agg(e.player_name, jsonb_build_object('mvp', 1))
from tmp_r32_official_mvp_eligible e
where not exists (
  select 1
  from public.scores s
  where s.entry_id = e.entry_id
    and s.match_date = e.match_date
)
group by e.entry_id, e.match_date;

create temporary table tmp_r16_qualified_nations (
  nation text primary key,
  match_date date not null
) on commit drop;

insert into tmp_r16_qualified_nations (nation, match_date)
values
  ('Canada', '2026-06-28'),
  ('Paraguay', '2026-06-29'),
  ('Brazil', '2026-06-29'),
  ('Morocco', '2026-06-30'),
  ('France', '2026-06-30'),
  ('Norway', '2026-06-30'),
  ('Mexico', '2026-07-01'),
  ('England', '2026-07-01'),
  ('Belgium', '2026-07-01'),
  ('United States', '2026-07-02'),
  ('Portugal', '2026-07-02'),
  ('Spain', '2026-07-02'),
  ('Switzerland', '2026-07-03'),
  ('Argentina', '2026-07-03'),
  ('Egypt', '2026-07-03'),
  ('Colombia', '2026-07-04');

create temporary table tmp_r16_bonus_eligible on commit drop as
select
  e.id as entry_id,
  q.match_date,
  x.player->>'name' as player_name
from public.entries e
cross join lateral jsonb_array_elements(coalesce(e.xi_json_r32, e.xi_json, '[]'::jsonb)) as x(player)
join tmp_r16_qualified_nations q
  on q.nation = x.player->>'nation'
where e.league_id = '11111111-1111-1111-1111-111111111111'
  and e.submitted_at <= '2026-06-28 19:00:00+00'::timestamptz
  and not coalesce((x.player->>'wild')::boolean, false)
  and not coalesce((x.player->>'empty')::boolean, false)
  and x.player->>'name' is not null;

create index on tmp_r16_bonus_eligible (entry_id, match_date);

with existing_add as (
  select
    s.entry_id,
    s.match_date,
    jsonb_object_agg(
      e.player_name,
      coalesce(s.breakdown->e.player_name, '{}'::jsonb)
        || jsonb_build_object('r16', 2)
    ) as patch_breakdown,
    (count(*) * 2)::int as added_points
  from public.scores s
  join tmp_r16_bonus_eligible e
    on e.entry_id = s.entry_id
   and e.match_date = s.match_date
  where coalesce((s.breakdown->e.player_name->>'r16')::int, 0) = 0
  group by s.entry_id, s.match_date
)
update public.scores s
   set breakdown = coalesce(s.breakdown, '{}'::jsonb) || existing_add.patch_breakdown,
       points = s.points + existing_add.added_points
from existing_add
where s.entry_id = existing_add.entry_id
  and s.match_date = existing_add.match_date;

insert into public.scores (entry_id, match_date, points, breakdown)
select
  e.entry_id,
  e.match_date,
  (count(*) * 2)::int as points,
  jsonb_object_agg(e.player_name, jsonb_build_object('r16', 2)) as breakdown
from tmp_r16_bonus_eligible e
where not exists (
  select 1
  from public.scores s
  where s.entry_id = e.entry_id
    and s.match_date = e.match_date
)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

with mvp_rows as (
  select
    m.external_id,
    m.match_date,
    pp.name,
    pp.nation,
    count(*) as owner_rows
  from tmp_r32_fifa_mvp m
  join public.scores s on s.match_date = m.match_date
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(player_name, detail)
  join public.player_pool pp
    on pp.name = b.player_name
   and pp.nation in (m.home_nation, m.away_nation)
  where coalesce((b.detail->>'mvp')::int, 0) <> 0
  group by m.external_id, m.match_date, pp.name, pp.nation
),
mvp_verify as (
  select
    count(*) filter (
      where coalesce(off_rows, 0) > 0 and coalesce(wrong_rows, 0) = 0
    ) as correct_mvp_fixtures,
    count(*) filter (
      where coalesce(off_rows, 0) = 0 or coalesce(wrong_rows, 0) <> 0
    ) as bad_mvp_fixtures
  from (
    select
      m.external_id,
      sum(r.owner_rows) filter (where r.name = m.player_name) as off_rows,
      sum(r.owner_rows) filter (where r.name <> m.player_name) as wrong_rows
    from tmp_r32_fifa_mvp m
    left join mvp_rows r on r.external_id = m.external_id
    group by m.external_id
  ) v
),
r16_verify as (
  select
    (select count(*) from tmp_r16_qualified_nations) as qualified_nations,
    (select count(*) from tmp_r16_bonus_eligible) as eligible_player_slots,
    coalesce(sum(r16_lines), 0)::int as awarded_player_slots,
    coalesce(sum(r16_points), 0)::int as awarded_points
  from (
    select
      count(*) filter (where coalesce((b.value->>'r16')::int, 0) = 2) as r16_lines,
      sum(coalesce((b.value->>'r16')::int, 0)) as r16_points
    from public.scores s
    cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(key, value)
    where s.match_date between '2026-06-28' and '2026-07-04'
  ) v
)
select
  mvp_verify.correct_mvp_fixtures,
  mvp_verify.bad_mvp_fixtures,
  r16_verify.qualified_nations,
  r16_verify.eligible_player_slots,
  r16_verify.awarded_player_slots,
  r16_verify.awarded_points
from mvp_verify
cross join r16_verify;
