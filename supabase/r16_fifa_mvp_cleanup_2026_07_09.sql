-- R16 FIFA official MVP cleanup (matches 89-96).
--
-- Source of truth: FIFA official Michelob Ultra Superior Player of the Match
-- list supplied on 2026-07-09.
--
-- Only two fixtures differed from the API-rating pick:
--   - Paraguay 0-1 France (1569870): UPAMECANO Dayot -> GILL Orlando (Paraguay,
--     losing-side goalkeeper)
--   - Portugal 0-1 Spain (1576756): MERINO Mikel -> RODRI (Spain)
-- The other six already matched FIFA; they are included for idempotent
-- verification and are no-ops.
--
-- Snapshot rule: R16 fixtures scored from current xi_json (R16 transfer window
-- closed 2026-07-04 16:00 UTC, so current xi_json is the R16 squad and
-- xi_json_r16 has not been frozen yet). Eligibility cut-off is the R16 deadline.

set statement_timeout = '5min';

create temporary table tmp_r16_fifa_mvp (
  external_id text primary key,
  match_date date not null,
  home_nation text not null,
  away_nation text not null,
  player_name text not null,
  player_nation text not null
) on commit drop;

insert into tmp_r16_fifa_mvp
  (external_id, match_date, home_nation, away_nation, player_name, player_nation)
values
  ('1569870', '2026-07-04', 'Paraguay', 'France', 'GILL Orlando', 'Paraguay'),
  ('1567824', '2026-07-04', 'Canada', 'Morocco', 'OUNAHI Azzedine', 'Morocco'),
  ('1568100', '2026-07-05', 'Brazil', 'Norway', 'HAALAND Erling', 'Norway'),
  ('1570714', '2026-07-06', 'Mexico', 'England', 'BELLINGHAM Jude', 'England'),
  ('1576756', '2026-07-06', 'Portugal', 'Spain', 'RODRI', 'Spain'),
  ('1570715', '2026-07-07', 'United States', 'Belgium', 'DE KETELAERE Charles', 'Belgium'),
  ('1576804', '2026-07-07', 'Argentina', 'Egypt', 'MESSI Lionel', 'Argentina'),
  ('1576805', '2026-07-07', 'Switzerland', 'Colombia', 'KOBEL Gregor', 'Switzerland');

-- Guard: every official MVP must exist in player_pool.
do $$
declare v_missing text;
begin
  select string_agg(m.external_id || ':' || m.player_name || ' (' || m.player_nation || ')', ', ')
    into v_missing
  from tmp_r16_fifa_mvp m
  left join public.player_pool pp on pp.name = m.player_name and pp.nation = m.player_nation
  where pp.name is null;
  if v_missing is not null then
    raise exception 'Missing MVP player_pool rows: %', v_missing;
  end if;
end;
$$;

-- Guard: every fixture must exist and be finished on the stated date.
do $$
declare v_missing text;
begin
  select string_agg(m.external_id || ':' || m.home_nation || '-' || m.away_nation, ', ')
    into v_missing
  from tmp_r16_fifa_mvp m
  left join public.matches mt
    on mt.external_id = m.external_id and mt.date = m.match_date
   and mt.home = m.home_nation and mt.away = m.away_nation and mt.status = 'finished'
  where mt.external_id is null;
  if v_missing is not null then
    raise exception 'Missing/unfinished R16 match rows: %', v_missing;
  end if;
end;
$$;

-- Names of every player who belongs to a given R16 fixture (either nation),
-- used to scope stale-MVP removal to the correct fixture on shared dates
-- (e.g. 2026-07-04 also holds the R32 Colombia-Ghana fixture).
create temporary table tmp_r16_fixture_player_names on commit drop as
select distinct m.external_id, m.match_date, pp.name
from tmp_r16_fifa_mvp m
join public.player_pool pp on pp.nation in (m.home_nation, m.away_nation);

-- Remove stale MVP flags from non-official players in the same fixture.
with expanded as (
  select
    s.entry_id, s.match_date,
    b.key as player_name, b.value as detail,
    m.player_name as official_player_name,
    fpn.name is not null as is_fixture_player
  from public.scores s
  join tmp_r16_fifa_mvp m on m.match_date = s.match_date
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(key, value)
  left join tmp_r16_fixture_player_names fpn
    on fpn.external_id = m.external_id and fpn.match_date = s.match_date and fpn.name = b.key
),
transformed as (
  select
    entry_id, match_date, player_name,
    case when bool_or(is_fixture_player and player_name <> official_player_name
                      and coalesce((detail->>'mvp')::int, 0) <> 0)
         then detail - 'mvp' else detail end as new_detail,
    case when bool_or(is_fixture_player and player_name <> official_player_name
                      and coalesce((detail->>'mvp')::int, 0) <> 0)
         then coalesce((detail->>'mvp')::int, 0) else 0 end as removed_points
  from expanded
  group by entry_id, match_date, player_name, detail
),
rebuilt as (
  select
    entry_id, match_date,
    coalesce(jsonb_object_agg(player_name, new_detail) filter (where new_detail <> '{}'::jsonb),
             '{}'::jsonb) as new_breakdown,
    sum(removed_points)::int as removed_points
  from transformed
  group by entry_id, match_date
  having sum(removed_points) > 0
)
update public.scores s
   set breakdown = rebuilt.new_breakdown,
       points = greatest(0, s.points - rebuilt.removed_points)
from rebuilt
where s.entry_id = rebuilt.entry_id and s.match_date = rebuilt.match_date;

-- Eligible official MVP owners: entries locked before the R16 deadline with
-- the official player in their R16 starting XI (current xi_json).
create temporary table tmp_r16_official_mvp_eligible on commit drop as
select distinct e.id as entry_id, m.match_date, m.player_name
from tmp_r16_fifa_mvp m
join public.entries e
  on e.league_id = '11111111-1111-1111-1111-111111111111'
 and e.submitted_at <= '2026-07-04 16:00:00+00'::timestamptz
cross join lateral jsonb_array_elements(coalesce(e.xi_json, '[]'::jsonb)) as x(player)
where not coalesce((x.player->>'wild')::boolean, false)
  and not coalesce((x.player->>'empty')::boolean, false)
  and x.player->>'name' = m.player_name
  and x.player->>'nation' = m.player_nation;

-- Add mvp:1 to existing score rows.
with existing_add as (
  select
    s.entry_id, s.match_date,
    jsonb_object_agg(e.player_name,
      coalesce(s.breakdown->e.player_name, '{}'::jsonb) || jsonb_build_object('mvp', 1)) as patch_breakdown,
    count(*)::int as added_points
  from public.scores s
  join tmp_r16_official_mvp_eligible e on e.entry_id = s.entry_id and e.match_date = s.match_date
  where coalesce((s.breakdown->e.player_name->>'mvp')::int, 0) = 0
  group by s.entry_id, s.match_date
)
update public.scores s
   set breakdown = coalesce(s.breakdown, '{}'::jsonb) || existing_add.patch_breakdown,
       points = s.points + existing_add.added_points
from existing_add
where s.entry_id = existing_add.entry_id and s.match_date = existing_add.match_date;

-- Insert new score rows for eligible owners who had no row for the date.
insert into public.scores (entry_id, match_date, points, breakdown)
select e.entry_id, e.match_date, count(*)::int,
       jsonb_object_agg(e.player_name, jsonb_build_object('mvp', 1))
from tmp_r16_official_mvp_eligible e
where not exists (
  select 1 from public.scores s where s.entry_id = e.entry_id and s.match_date = e.match_date)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- Verification: exactly one official MVP per fixture, no wrong-player rows.
with mvp_rows as (
  select m.external_id, pp.name, count(*) as owner_rows
  from tmp_r16_fifa_mvp m
  join public.scores s on s.match_date = m.match_date
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(player_name, detail)
  join public.player_pool pp on pp.name = b.player_name and pp.nation in (m.home_nation, m.away_nation)
  where coalesce((b.detail->>'mvp')::int, 0) <> 0
  group by m.external_id, pp.name
)
select
  m.external_id, m.home_nation || '-' || m.away_nation as match, m.player_name as official_mvp,
  coalesce(sum(r.owner_rows) filter (where r.name = m.player_name), 0) as official_rows,
  coalesce(sum(r.owner_rows) filter (where r.name <> m.player_name), 0) as wrong_rows
from tmp_r16_fifa_mvp m
left join mvp_rows r on r.external_id = m.external_id
group by m.external_id, m.home_nation, m.away_nation, m.player_name
order by m.match_date, m.external_id;
