-- Fix MD3 under-scoring after the R32 transfer window opened.
--
-- Symptom:
--   Some MD3 player match stats were present only for a subset of owners, while
--   the later R32 progression bonus (`r32: 2`) was present for all eligible
--   MD3 owners. Example: `KANE Harry` had `{goals:1, win:1, r32:2}` for only
--   part of his MD3 owners, and `{r32:2}` for the rest.
--
-- Cause pattern:
--   MD3 scoring happened while R32 transfers were open. The scoring squad was
--   correctly `xi_json_gw3`, but some earlier scoring passes produced partial
--   owner coverage for the match-stat breakdown. This patch normalizes owner
--   coverage from the canonical match stat line already present in scores.
--
-- Safe/idempotent:
--   - Uses `xi_json_gw3`, not current `xi_json`.
--   - Does not touch wildcard bench.
--   - Adds only missing match-stat keys; preserves existing `r32` and other
--     player keys.
--   - Can be rerun: already-present keys are not added twice.

set statement_timeout = '5min';

create temporary table tmp_md3_fixture_nations on commit drop as
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

-- Canonical stat line per player/date, inferred from the richest stat rows
-- that already exist. R32 progression is intentionally excluded here.
create temporary table tmp_md3_canonical_stats on commit drop as
with score_lines as (
  select
    s.match_date,
    b.key as player_name,
    b.value as stats
  from public.scores s
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) b(key, value)
  join public.player_pool pp
    on pp.name = b.key
  join tmp_md3_fixture_nations fn
    on fn.nation = pp.nation
   and fn.match_date = s.match_date
  where s.match_date between '2026-06-24' and '2026-06-28'
),
aggregated as (
  select
    match_date,
    player_name,
    max(coalesce((stats->>'win')::int, 0)) as win,
    max(coalesce((stats->>'full90')::int, 0)) as full90,
    max(coalesce((stats->>'goals')::int, 0)) as goals,
    max(coalesce((stats->>'assists')::int, 0)) as assists,
    max(coalesce((stats->>'cleanSheet')::int, 0)) as clean_sheet,
    max(coalesce((stats->>'mvp')::int, 0)) as mvp,
    bool_or(stats ? 'red') as has_red
  from score_lines
  group by match_date, player_name
),
canonical as (
  select
    match_date,
    player_name,
    jsonb_strip_nulls(jsonb_build_object(
      'win',        case when win > 0 then win end,
      'full90',     case when full90 > 0 then full90 end,
      'goals',      case when goals > 0 then goals end,
      'assists',    case when assists > 0 then assists end,
      'cleanSheet', case when clean_sheet > 0 then clean_sheet end,
      'mvp',        case when mvp > 0 then mvp end,
      'red',        case when has_red then -1 end
    )) as stats,
    (
      win + full90 + goals + assists + clean_sheet + mvp
      + case when has_red then -1 else 0 end
    )::int as points
  from aggregated
)
select *
from canonical
where stats <> '{}'::jsonb
  and points <> 0;

create index on tmp_md3_canonical_stats (match_date, player_name);

create temporary table tmp_md3_eligible_owner_players on commit drop as
select
  e.id as entry_id,
  fn.match_date,
  x.player->>'name' as player_name
from public.entries e
cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw3, e.xi_json)) x(player)
join tmp_md3_fixture_nations fn
  on fn.nation = x.player->>'nation'
join tmp_md3_canonical_stats cs
  on cs.match_date = fn.match_date
 and cs.player_name = x.player->>'name'
where e.league_id = '11111111-1111-1111-1111-111111111111'
  and e.submitted_at <= '2026-06-24 19:00:00+00'::timestamptz
  and not coalesce((x.player->>'wild')::boolean, false);

create index on tmp_md3_eligible_owner_players (entry_id, match_date);

-- Patch existing score rows.
with player_patches as (
  select
    s.entry_id,
    s.match_date,
    e.player_name,
    coalesce(s.breakdown->e.player_name, '{}'::jsonb) as current_stats,
    cs.stats as canonical_stats
  from public.scores s
  join tmp_md3_eligible_owner_players e
    on e.entry_id = s.entry_id
   and e.match_date = s.match_date
  join tmp_md3_canonical_stats cs
    on cs.match_date = e.match_date
   and cs.player_name = e.player_name
),
missing as (
  select
    entry_id,
    match_date,
    player_name,
    current_stats,
    jsonb_strip_nulls(jsonb_build_object(
      'win',        case when canonical_stats ? 'win'        and not current_stats ? 'win'        then (canonical_stats->>'win')::int end,
      'full90',     case when canonical_stats ? 'full90'     and not current_stats ? 'full90'     then (canonical_stats->>'full90')::int end,
      'goals',      case when canonical_stats ? 'goals'      and not current_stats ? 'goals'      then (canonical_stats->>'goals')::int end,
      'assists',    case when canonical_stats ? 'assists'    and not current_stats ? 'assists'    then (canonical_stats->>'assists')::int end,
      'cleanSheet', case when canonical_stats ? 'cleanSheet' and not current_stats ? 'cleanSheet' then (canonical_stats->>'cleanSheet')::int end,
      'mvp',        case when canonical_stats ? 'mvp'        and not current_stats ? 'mvp'        then (canonical_stats->>'mvp')::int end,
      'red',        case when canonical_stats ? 'red'        and not current_stats ? 'red'        then (canonical_stats->>'red')::int end
    )) as patch,
    (
      case when canonical_stats ? 'win'        and not current_stats ? 'win'        then (canonical_stats->>'win')::int        else 0 end
    + case when canonical_stats ? 'full90'     and not current_stats ? 'full90'     then (canonical_stats->>'full90')::int     else 0 end
    + case when canonical_stats ? 'goals'      and not current_stats ? 'goals'      then (canonical_stats->>'goals')::int      else 0 end
    + case when canonical_stats ? 'assists'    and not current_stats ? 'assists'    then (canonical_stats->>'assists')::int    else 0 end
    + case when canonical_stats ? 'cleanSheet' and not current_stats ? 'cleanSheet' then (canonical_stats->>'cleanSheet')::int else 0 end
    + case when canonical_stats ? 'mvp'        and not current_stats ? 'mvp'        then (canonical_stats->>'mvp')::int        else 0 end
    + case when canonical_stats ? 'red'        and not current_stats ? 'red'        then -1 else 0 end
    )::int as patch_points
  from player_patches
),
rebuilt as (
  select
    entry_id,
    match_date,
    jsonb_object_agg(player_name, current_stats || patch) as patch_breakdown,
    sum(patch_points)::int as added_points
  from missing
  where patch <> '{}'::jsonb
  group by entry_id, match_date
)
update public.scores s
   set breakdown = coalesce(s.breakdown, '{}'::jsonb) || rebuilt.patch_breakdown,
       points = s.points + rebuilt.added_points
from rebuilt
where s.entry_id = rebuilt.entry_id
  and s.match_date = rebuilt.match_date;

-- Insert score rows that were completely absent for a date/player.
insert into public.scores (entry_id, match_date, points, breakdown)
select
  e.entry_id,
  e.match_date,
  sum(cs.points)::int as points,
  jsonb_object_agg(e.player_name, cs.stats) as breakdown
from tmp_md3_eligible_owner_players e
join tmp_md3_canonical_stats cs
  on cs.match_date = e.match_date
 and cs.player_name = e.player_name
where not exists (
  select 1
  from public.scores s
  where s.entry_id = e.entry_id
    and s.match_date = e.match_date
)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- Verification focused on the reported case and overall normalized coverage.
with kane as (
  select
    count(*) as kane_md3_starters,
    count(*) filter (
      where coalesce((s.breakdown->'KANE Harry'->>'goals')::int, 0) = 1
        and coalesce((s.breakdown->'KANE Harry'->>'win')::int, 0) = 1
    ) as kane_goal_win_rows
  from tmp_md3_eligible_owner_players e
  left join public.scores s
    on s.entry_id = e.entry_id
   and s.match_date = e.match_date
  where e.player_name = 'KANE Harry'
),
coverage as (
  select
    count(*) as eligible_player_rows,
    count(*) filter (
      where cs.stats <@ coalesce(s.breakdown->e.player_name, '{}'::jsonb)
    ) as normalized_player_rows
  from tmp_md3_eligible_owner_players e
  join tmp_md3_canonical_stats cs
    on cs.match_date = e.match_date
   and cs.player_name = e.player_name
  left join public.scores s
    on s.entry_id = e.entry_id
   and s.match_date = e.match_date
)
select
  kane.kane_md3_starters,
  kane.kane_goal_win_rows,
  coverage.eligible_player_rows,
  coverage.normalized_player_rows
from kane, coverage;
