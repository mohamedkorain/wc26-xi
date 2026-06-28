-- Manual MVP cleanup for Group Stage MD3 using FIFA's official
-- Michelob Ultra Superior Player of the Match list supplied on 2026-06-28.
--
-- This patch is idempotent:
--   - removes stale MVP flags for players from the same fixture nations
--   - awards the official MVP to eligible MD3 starters from xi_json_gw3
--   - inserts a score row when the MVP is the player's only point on that date
--
-- Important: MD3 scoring uses the frozen xi_json_gw3 snapshot. Do not use
-- current xi_json after the R32 transfer window opened.

set statement_timeout = '5min';

create temporary table tmp_md3_fifa_mvp (
  external_id text primary key,
  match_date date not null,
  home_nation text not null,
  away_nation text not null,
  player_name text not null,
  player_nation text not null
) on commit drop;

insert into tmp_md3_fifa_mvp
  (external_id, match_date, home_nation, away_nation, player_name, player_nation)
values
  ('1489408', '2026-06-24', 'Switzerland', 'Canada', 'MANZAMBI Johan', 'Switzerland'),
  ('1539009', '2026-06-24', 'Bosnia and Herzegovina', 'Qatar', 'ALAJBEGOVIC Kerim', 'Bosnia and Herzegovina'),
  ('1489405', '2026-06-24', 'Morocco', 'Haiti', 'HAKIMI Achraf', 'Morocco'),
  ('1489406', '2026-06-24', 'Scotland', 'Brazil', 'VINICIUS JUNIOR', 'Brazil'),
  ('1539010', '2026-06-25', 'Czech Republic', 'Mexico', 'CHAVEZ Mateo', 'Mexico'),
  ('1489407', '2026-06-25', 'South Africa', 'South Korea', 'MASEKO Thapelo', 'South Africa'),
  ('1489409', '2026-06-25', 'Curaçao', 'Ivory Coast', 'PEPE Nicolas', 'Ivory Coast'),
  ('1489410', '2026-06-25', 'Ecuador', 'Germany', 'ANGULO Nilson', 'Ecuador'),
  ('1539011', '2026-06-25', 'Japan', 'Sweden', 'ELANGA Anthony', 'Sweden'),
  ('1489412', '2026-06-25', 'Tunisia', 'Netherlands', 'BROBBEY Brian', 'Netherlands'),
  ('1539012', '2026-06-26', 'Turkey', 'United States', 'GULER Arda', 'Turkey'),
  ('1489411', '2026-06-26', 'Paraguay', 'Australia', 'ONEILL Aiden', 'Australia'),
  ('1489416', '2026-06-26', 'Norway', 'France', 'DEMBELE Ousmane', 'France'),
  ('1539074', '2026-06-26', 'Senegal', 'Iraq', 'GUEYE Pape', 'Senegal'),
  ('1489414', '2026-06-27', 'Egypt', 'Iran', 'REZAEIAN Ramin', 'Iran'),
  ('1489415', '2026-06-27', 'New Zealand', 'Belgium', 'TROSSARD Leandro', 'Belgium'),
  ('1489413', '2026-06-27', 'Cape Verde', 'Saudi Arabia', 'DEROY DUARTE', 'Cape Verde'),
  ('1489417', '2026-06-27', 'Uruguay', 'Spain', 'BAENA Alex', 'Spain'),
  ('1489422', '2026-06-27', 'Panama', 'England', 'BELLINGHAM Jude', 'England'),
  ('1489420', '2026-06-27', 'Croatia', 'Ghana', 'SUCIC Petar', 'Croatia'),
  ('1489418', '2026-06-28', 'Algeria', 'Austria', 'MAHREZ Riyad', 'Algeria'),
  ('1489421', '2026-06-28', 'Jordan', 'Argentina', 'LO CELSO Giovani', 'Argentina'),
  ('1489419', '2026-06-27', 'Colombia', 'Portugal', 'DIOGO COSTA', 'Portugal'),
  ('1539013', '2026-06-27', 'DR Congo', 'Uzbekistan', 'WISSA Yoane', 'DR Congo');

-- Guard against typos in the official mapping before touching scores.
do $$
declare
  v_missing text;
begin
  select string_agg(m.external_id || ':' || m.player_name || ' (' || m.player_nation || ')', ', ')
    into v_missing
  from tmp_md3_fifa_mvp m
  left join public.player_pool pp
    on pp.name = m.player_name
   and pp.nation = m.player_nation
  where pp.name is null;

  if v_missing is not null then
    raise exception 'Missing MVP player_pool rows: %', v_missing;
  end if;
end;
$$;

create temporary table tmp_md3_fixture_player_names on commit drop as
select distinct
  m.external_id,
  m.match_date,
  pp.name
from tmp_md3_fifa_mvp m
join public.player_pool pp
  on pp.nation in (m.home_nation, m.away_nation);

-- Remove stale MVP flags from non-official players in the same fixture.
with expanded as (
  select
    s.entry_id,
    s.match_date,
    s.points,
    b.key as player_name,
    b.value as detail,
    m.player_name as official_player_name,
    fpn.name is not null as is_fixture_player
  from public.scores s
  join tmp_md3_fifa_mvp m
    on m.match_date = s.match_date
  cross join lateral jsonb_each(s.breakdown) as b(key, value)
  left join tmp_md3_fixture_player_names fpn
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

-- Eligible official MVP owners: pre-MD3-deadline entries with the player in
-- the frozen MD3 starting XI.
create temporary table tmp_md3_official_mvp_eligible on commit drop as
select
  e.id as entry_id,
  m.match_date,
  m.player_name
from tmp_md3_fifa_mvp m
join public.entries e
  on e.league_id = '11111111-1111-1111-1111-111111111111'
 and e.submitted_at <= '2026-06-24 19:00:00+00'::timestamptz
cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw3, e.xi_json)) as x(player)
where not coalesce((x.player->>'wild')::boolean, false)
  and x.player->>'name' = m.player_name
  and x.player->>'nation' = m.player_nation;

-- Add MVP to existing score rows where the official player already has a row
-- or needs an MVP-only breakdown on a date with other points. Multiple official
-- MVPs can belong to the same entry/date because several fixtures share a date.
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
  join tmp_md3_official_mvp_eligible e
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

-- Insert MVP-only score rows where the official MVP is the user's only scoring
-- player on that date.
insert into public.scores (entry_id, match_date, points, breakdown)
select
  e.entry_id,
  e.match_date,
  count(*)::int,
  jsonb_object_agg(e.player_name, jsonb_build_object('mvp', 1))
from tmp_md3_official_mvp_eligible e
where not exists (
  select 1
  from public.scores s
  where s.entry_id = e.entry_id
    and s.match_date = e.match_date
)
group by e.entry_id, e.match_date;

-- Keep player leaderboard current. Entry leaderboard/ranks should be refreshed
-- only after scoring_progress returns to offset 0 for all active dates.
select public.refresh_player_leaderboard();

-- Verification: should show exactly one MVP player per fixture.
with mvp_rows as (
  select
    m.external_id,
    m.match_date,
    pp.name,
    pp.nation,
    count(*) as owner_rows
  from tmp_md3_fifa_mvp m
  join public.scores s on s.match_date = m.match_date
  cross join lateral jsonb_each(s.breakdown) as b(player_name, detail)
  join public.player_pool pp
    on pp.name = b.player_name
   and pp.nation in (m.home_nation, m.away_nation)
  where coalesce((b.detail->>'mvp')::int, 0) <> 0
  group by m.external_id, m.match_date, pp.name, pp.nation
)
select
  m.external_id,
  m.match_date,
  m.player_name as official_mvp,
  coalesce(string_agg(r.name || ' (' || r.nation || '): ' || r.owner_rows, ', ' order by r.owner_rows desc, r.name), '') as live_mvp_rows
from tmp_md3_fifa_mvp m
left join mvp_rows r on r.external_id = m.external_id
group by m.external_id, m.match_date, m.player_name
order by m.match_date, m.external_id;
