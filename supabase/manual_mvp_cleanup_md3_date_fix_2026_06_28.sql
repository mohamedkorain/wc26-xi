-- Correct MD3 FIFA MVP dates for Colombia-Portugal and Congo DR-Uzbekistan.
--
-- The first MD3 FIFA cleanup used 2026-06-28 for these two fixtures, but
-- production `matches.date` stores them as 2026-06-27. This patch removes the
-- wrongly dated MVP points and awards the same official MVPs on the correct
-- match date using the frozen MD3 squad snapshot (`xi_json_gw3`).

set statement_timeout = '5min';

create temporary table tmp_md3_mvp_date_fix (
  external_id text primary key,
  match_date date not null,
  wrong_match_date date not null,
  home_nation text not null,
  away_nation text not null,
  player_name text not null,
  player_nation text not null
) on commit drop;

insert into tmp_md3_mvp_date_fix
  (external_id, match_date, wrong_match_date, home_nation, away_nation, player_name, player_nation)
values
  ('1489419', '2026-06-27', '2026-06-28', 'Colombia', 'Portugal', 'DIOGO COSTA', 'Portugal'),
  ('1539013', '2026-06-27', '2026-06-28', 'DR Congo', 'Uzbekistan', 'WISSA Yoane', 'DR Congo');

-- Remove wrongly dated MVP points only for these two players.
with expanded as (
  select
    s.entry_id,
    s.match_date,
    s.points,
    b.key as player_name,
    b.value as detail,
    f.player_name is not null as is_wrong_player
  from public.scores s
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(key, value)
  left join tmp_md3_mvp_date_fix f
    on f.wrong_match_date = s.match_date
   and f.player_name = b.key
  where s.match_date in (select wrong_match_date from tmp_md3_mvp_date_fix)
),
rebuilt as (
  select
    entry_id,
    match_date,
    coalesce(
      jsonb_object_agg(
        player_name,
        case when is_wrong_player then detail - 'mvp' else detail end
      ) filter (
        where case when is_wrong_player then detail - 'mvp' else detail end <> '{}'::jsonb
      ),
      '{}'::jsonb
    ) as new_breakdown,
    sum(
      case
        when is_wrong_player then coalesce((detail->>'mvp')::int, 0)
        else 0
      end
    )::int as removed_points
  from expanded
  group by entry_id, match_date
  having sum(
    case
      when is_wrong_player then coalesce((detail->>'mvp')::int, 0)
      else 0
    end
  ) > 0
)
update public.scores s
   set breakdown = rebuilt.new_breakdown,
       points = greatest(0, s.points - rebuilt.removed_points)
from rebuilt
where s.entry_id = rebuilt.entry_id
  and s.match_date = rebuilt.match_date;

delete from public.scores
where match_date in (select wrong_match_date from tmp_md3_mvp_date_fix)
  and points = 0
  and coalesce(breakdown, '{}'::jsonb) = '{}'::jsonb;

-- Remove stale MVP flags for other players from the same two fixtures on the
-- correct date.
create temporary table tmp_md3_fix_fixture_player_names on commit drop as
select distinct
  f.external_id,
  f.match_date,
  pp.name
from tmp_md3_mvp_date_fix f
join public.player_pool pp
  on pp.nation in (f.home_nation, f.away_nation);

with expanded as (
  select
    s.entry_id,
    s.match_date,
    s.points,
    b.key as player_name,
    b.value as detail,
    f.player_name as official_player_name,
    fpn.name is not null as is_fixture_player
  from public.scores s
  join tmp_md3_mvp_date_fix f
    on f.match_date = s.match_date
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(key, value)
  left join tmp_md3_fix_fixture_player_names fpn
    on fpn.external_id = f.external_id
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
create temporary table tmp_md3_fix_official_mvp_eligible on commit drop as
select
  e.id as entry_id,
  f.match_date,
  f.player_name
from tmp_md3_mvp_date_fix f
join public.entries e
  on e.league_id = '11111111-1111-1111-1111-111111111111'
 and e.submitted_at <= '2026-06-24 19:00:00+00'::timestamptz
cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw3, e.xi_json)) as x(player)
where not coalesce((x.player->>'wild')::boolean, false)
  and x.player->>'name' = f.player_name
  and x.player->>'nation' = f.player_nation;

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
  join tmp_md3_fix_official_mvp_eligible e
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
from tmp_md3_fix_official_mvp_eligible e
where not exists (
  select 1
  from public.scores s
  where s.entry_id = e.entry_id
    and s.match_date = e.match_date
)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();

-- Verification: wrong-date counts should be zero and correct-date counts
-- should match eligible owners.
with eligible as (
  select player_name, count(*) as eligible_owners
  from tmp_md3_fix_official_mvp_eligible
  group by player_name
),
score_mvps as (
  select
    f.player_name,
    s.match_date,
    count(*) as mvp_rows
  from tmp_md3_mvp_date_fix f
  join public.scores s
    on s.match_date in (f.match_date, f.wrong_match_date)
   and s.breakdown ? f.player_name
  where coalesce((s.breakdown->f.player_name->>'mvp')::int, 0) <> 0
  group by f.player_name, s.match_date
)
select
  f.player_name,
  e.eligible_owners,
  coalesce(string_agg(sm.match_date::text || ':' || sm.mvp_rows, ', ' order by sm.match_date), '') as mvp_rows_by_date
from tmp_md3_mvp_date_fix f
join eligible e on e.player_name = f.player_name
left join score_mvps sm on sm.player_name = f.player_name
group by f.player_name, e.eligible_owners
order by f.player_name;
