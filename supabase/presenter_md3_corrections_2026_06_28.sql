-- Admin MD3 presenter corrections for the Saba7o mini-league.
--
-- These are MD3 transfers, not R32 transfers:
--   Saba7o:
--     WOOD Chris       -> MESSI Lionel
--     ZAID TAHSEEN     -> GABRIEL MAGALHAES
--
--   OA FC:
--     SAKA Bukayo      -> DIAZ Luis
--     YAZAN ALARAB     -> CUCURELLA Marc
--
--   Boca Seniors:
--     SOUCEK Tomas     -> EMAM ASHOUR
--     SEMENYO Antoine  -> PEDRO NETO
--
-- Because the R32 window was opened by freezing xi_json_gw3 from current
-- squads, and these presenter entries have no R32 transfer logs yet, this
-- patch aligns both xi_json_gw3 and current xi_json. It then rebuilds only
-- these three entries' MD3 score rows from canonical score breakdowns already
-- present in public.scores, including the R32 progression bonus.

set statement_timeout = '5min';

do $$
declare
  v_saba7o constant uuid := '8bf0e040-6920-4a8b-9909-63afca7ca413';
  v_oa constant uuid := 'b4bf20e4-e454-4859-9dd7-c2ec55874ee9';
  v_boca constant uuid := 'a098a535-a561-428b-b978-b1ff413e6683';
  v_started_at timestamptz := now();
  v_updated_entries int := 0;
  v_deleted_scores int := 0;
  v_inserted_scores int := 0;
  v_log_rows int := 0;
begin
  create temp table target_entries (
    entry_id uuid primary key,
    team_name text not null
  ) on commit drop;

  insert into target_entries(entry_id, team_name)
  values
    (v_saba7o, 'Saba7o'),
    (v_oa, 'OA FC'),
    (v_boca, 'Boca Seniors');

  if (
    select count(*)
    from public.entries e
    join target_entries te on te.entry_id = e.id
    where e.team_name = te.team_name
      and coalesce(e.transfers_used, 0) = 0
      and jsonb_array_length(coalesce(e.xi_json_gw3, '[]'::jsonb)) = 12
  ) <> 3 then
    raise exception 'Expected 3 presenter entries with transfers_used=0 and 12-player GW3 snapshots';
  end if;

  if exists (
    select 1
    from public.transfer_logs tl
    join target_entries te on te.entry_id = tl.entry_id
    where tl.changed_at >= '2026-06-28 00:00:00+00'::timestamptz
  ) then
    raise exception 'A target presenter entry already has R32-era transfer logs; refusing to overwrite current xi_json';
  end if;

  create temp table expected_outgoing (
    entry_id uuid not null,
    slot_idx int not null,
    outgoing_name text not null,
    incoming_nation text not null,
    incoming_name text not null,
    primary key (entry_id, slot_idx)
  ) on commit drop;

  insert into expected_outgoing(entry_id, slot_idx, outgoing_name, incoming_nation, incoming_name)
  values
    (v_saba7o, 10, 'WOOD Chris',      'Argentina', 'MESSI Lionel'),
    (v_saba7o,  2, 'ZAID TAHSEEN',    'Brazil',    'GABRIEL MAGALHAES'),
    (v_oa,      8, 'SAKA Bukayo',     'Colombia',  'DIAZ Luis'),
    (v_oa,      3, 'YAZAN ALARAB',    'Spain',     'CUCURELLA Marc'),
    (v_boca,    6, 'SOUCEK Tomas',    'Egypt',     'EMAM ASHOUR'),
    (v_boca,    8, 'SEMENYO Antoine', 'Portugal',  'PEDRO NETO');

  if (
    select count(*)
    from expected_outgoing eo
    join public.entries e on e.id = eo.entry_id
    cross join lateral jsonb_array_elements(e.xi_json_gw3) with ordinality as slot(player, ord)
    where slot.ord - 1 = eo.slot_idx
      and slot.player->>'name' = eo.outgoing_name
  ) <> 6 then
    raise exception 'At least one expected outgoing MD3 player/slot does not match production';
  end if;

  if (
    select count(*)
    from expected_outgoing eo
    join public.player_pool pp
      on pp.nation = eo.incoming_nation
     and pp.name = eo.incoming_name
  ) <> 6 then
    raise exception 'At least one incoming player is missing from player_pool';
  end if;

  create temp table corrected_squads (
    entry_id uuid primary key,
    new_gw3 jsonb not null
  ) on commit drop;

  with patched as (
    select
      e.id as entry_id,
      jsonb_agg(
        case
          when eo.entry_id is not null then
            jsonb_build_object(
              'arab',        pp.arab,
              'bucket',      slot.player->>'bucket',
              'category',    pp.category,
              'club',        pp.club,
              'name',        pp.name,
              'nation',      pp.nation,
              'nation_code', pp.nation_code,
              'no',          pp.no,
              'role',        slot.player->>'role',
              'shirt_name',  pp.shirt_name,
              'slot',        eo.slot_idx,
              'tag',         slot.player->>'tag',
              'wild',        false
            )
          else slot.player
        end
        order by slot.ord
      ) as new_gw3
    from public.entries e
    join target_entries te on te.entry_id = e.id
    cross join lateral jsonb_array_elements(e.xi_json_gw3) with ordinality as slot(player, ord)
    left join expected_outgoing eo
      on eo.entry_id = e.id
     and eo.slot_idx = slot.ord - 1
    left join public.player_pool pp
      on pp.nation = eo.incoming_nation
     and pp.name = eo.incoming_name
    group by e.id
  )
  insert into corrected_squads(entry_id, new_gw3)
  select entry_id, new_gw3
  from patched;

  if (select count(*) from corrected_squads) <> 3 then
    raise exception 'Failed to build all three corrected MD3 squads';
  end if;

  if exists (
    select 1
    from corrected_squads cs
    where jsonb_array_length(cs.new_gw3) <> 12
  ) then
    raise exception 'Corrected MD3 squads must contain exactly 12 players';
  end if;

  if exists (
    select 1
    from corrected_squads cs
    cross join lateral jsonb_array_elements(cs.new_gw3) as slot(player)
    group by cs.entry_id
    having count(*) filter (where coalesce((slot.player->>'wild')::boolean, false)) <> 1
  ) then
    raise exception 'Corrected MD3 squads must contain exactly one wildcard';
  end if;

  if exists (
    select 1
    from corrected_squads cs
    cross join lateral jsonb_array_elements(cs.new_gw3) as slot(player)
    group by cs.entry_id
    having count(distinct (slot.player->>'nation') || chr(31) || (slot.player->>'name')) <> 12
  ) then
    raise exception 'Corrected MD3 squads cannot contain duplicate players';
  end if;

  create temp table md3_fixture_by_nation on commit drop as
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
  ) md3
  group by nation;

  create temp table r32_qualified_nations on commit drop as
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

  create temp table selected_starters on commit drop as
  select
    cs.entry_id,
    slot.player->>'name' as player_name,
    slot.player->>'nation' as nation,
    md3.match_date
  from corrected_squads cs
  cross join lateral jsonb_array_elements(cs.new_gw3) as slot(player)
  join md3_fixture_by_nation md3
    on md3.nation = slot.player->>'nation'
  where not coalesce((slot.player->>'wild')::boolean, false)
    and slot.player->>'name' is not null;

  create temp table canonical_md3_player_scores on commit drop as
  with score_lines as (
    select
      s.match_date,
      b.key as player_name,
      b.value as stats
    from public.scores s
    cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) b(key, value)
    join selected_starters ss
      on ss.player_name = b.key
     and ss.match_date = s.match_date
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
      max(coalesce((stats->>'r32')::int, 0)) as r32,
      bool_or(stats ? 'red') as has_red
    from score_lines
    group by match_date, player_name
  )
  select
    ss.match_date,
    ss.player_name,
    jsonb_strip_nulls(jsonb_build_object(
      'win',        case when coalesce(a.win, 0) > 0 then a.win end,
      'full90',     case when coalesce(a.full90, 0) > 0 then a.full90 end,
      'goals',      case when coalesce(a.goals, 0) > 0 then a.goals end,
      'assists',    case when coalesce(a.assists, 0) > 0 then a.assists end,
      'cleanSheet', case when coalesce(a.clean_sheet, 0) > 0 then a.clean_sheet end,
      'mvp',        case when coalesce(a.mvp, 0) > 0 then a.mvp end,
      'r32',        case when greatest(coalesce(a.r32, 0), case when q.nation is not null then 2 else 0 end) > 0
                         then greatest(coalesce(a.r32, 0), case when q.nation is not null then 2 else 0 end)
                    end,
      'red',        case when coalesce(a.has_red, false) then -1 end
    )) as stats
  from selected_starters ss
  left join aggregated a
    on a.match_date = ss.match_date
   and a.player_name = ss.player_name
  left join r32_qualified_nations q
    on q.nation = ss.nation;

  execute 'alter table public.entries disable trigger guard_locked_entry_transfer_trg';

  update public.entries e
     set xi_json_gw3 = cs.new_gw3,
         xi_json = cs.new_gw3
  from corrected_squads cs
  where e.id = cs.entry_id;

  get diagnostics v_updated_entries = row_count;

  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';

  if v_updated_entries <> 3 then
    raise exception 'Expected to update exactly 3 entries, updated %', v_updated_entries;
  end if;

  update public.transfer_logs
     set event_type = 'admin_md3_presenter_correction'
   where entry_id in (v_saba7o, v_oa, v_boca)
     and changed_at >= v_started_at
     and transfer_delta = 0
     and event_type = 'wildcard_swap';

  get diagnostics v_log_rows = row_count;

  delete from public.scores
   where entry_id in (v_saba7o, v_oa, v_boca)
     and match_date between '2026-06-24' and '2026-06-28';

  get diagnostics v_deleted_scores = row_count;

  with per_player as (
    select
      ss.entry_id,
      ss.match_date,
      ss.player_name,
      ps.stats,
      (
          coalesce((ps.stats->>'win')::int, 0)
        + coalesce((ps.stats->>'full90')::int, 0)
        + coalesce((ps.stats->>'goals')::int, 0)
        + coalesce((ps.stats->>'assists')::int, 0)
        + coalesce((ps.stats->>'cleanSheet')::int, 0)
        + coalesce((ps.stats->>'mvp')::int, 0)
        + coalesce((ps.stats->>'r32')::int, 0)
        + coalesce((ps.stats->>'red')::int, 0)
      )::int as points
    from selected_starters ss
    join canonical_md3_player_scores ps
      on ps.match_date = ss.match_date
     and ps.player_name = ss.player_name
    where ps.stats <> '{}'::jsonb
  ),
  by_entry_date as (
    select
      entry_id,
      match_date,
      sum(points)::int as points,
      jsonb_object_agg(player_name, stats order by player_name) as breakdown
    from per_player
    group by entry_id, match_date
    having sum(points) <> 0 or bool_or(stats <> '{}'::jsonb)
  )
  insert into public.scores (entry_id, match_date, points, breakdown)
  select entry_id, match_date, points, breakdown
  from by_entry_date
  on conflict (entry_id, match_date)
  do update set
    points = excluded.points,
    breakdown = excluded.breakdown;

  get diagnostics v_inserted_scores = row_count;

  raise notice 'MD3 presenter correction applied. entries=%, deleted_scores=%, rebuilt_scores=%, audit_logs=%',
    v_updated_entries, v_deleted_scores, v_inserted_scores, v_log_rows;
exception
  when others then
    begin
      execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
    exception when others then
      null;
    end;
    raise;
end $$;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

with changed_slots as (
  select
    e.team_name,
    'gw3' as squad,
    slot.ord - 1 as idx,
    slot.player->>'name' as player_name,
    slot.player->>'nation' as nation,
    slot.player->>'role' as role,
    slot.player->>'tag' as tag
  from public.entries e
  cross join lateral jsonb_array_elements(e.xi_json_gw3) with ordinality as slot(player, ord)
  where e.id in (
    '8bf0e040-6920-4a8b-9909-63afca7ca413',
    'b4bf20e4-e454-4859-9dd7-c2ec55874ee9',
    'a098a535-a561-428b-b978-b1ff413e6683'
  )
    and slot.ord - 1 in (2, 3, 6, 8, 10)
  union all
  select
    e.team_name,
    'current' as squad,
    slot.ord - 1 as idx,
    slot.player->>'name' as player_name,
    slot.player->>'nation' as nation,
    slot.player->>'role' as role,
    slot.player->>'tag' as tag
  from public.entries e
  cross join lateral jsonb_array_elements(e.xi_json) with ordinality as slot(player, ord)
  where e.id in (
    '8bf0e040-6920-4a8b-9909-63afca7ca413',
    'b4bf20e4-e454-4859-9dd7-c2ec55874ee9',
    'a098a535-a561-428b-b978-b1ff413e6683'
  )
    and slot.ord - 1 in (2, 3, 6, 8, 10)
)
select *
from changed_slots
order by team_name, squad, idx;

select
  e.team_name,
  s.match_date,
  s.points,
  s.breakdown
from public.scores s
join public.entries e on e.id = s.entry_id
where e.id in (
  '8bf0e040-6920-4a8b-9909-63afca7ca413',
  'b4bf20e4-e454-4859-9dd7-c2ec55874ee9',
  'a098a535-a561-428b-b978-b1ff413e6683'
)
  and s.match_date between '2026-06-24' and '2026-06-28'
order by e.team_name, s.match_date;

select
  e.team_name,
  lt.total_points,
  e.rank_current
from public.entries e
left join public.leaderboard_totals lt on lt.entry_id = e.id
where e.id in (
  '8bf0e040-6920-4a8b-9909-63afca7ca413',
  'b4bf20e4-e454-4859-9dd7-c2ec55874ee9',
  'a098a535-a561-428b-b978-b1ff413e6683'
)
order by e.team_name;
