-- Admin MD2 presenter corrections for the Saba7o mini-league.
--
-- Boca Seniors (a098a535-a561-428b-b978-b1ff413e6683):
--   LOGAN COSTA        -> MARQUINHOS
--   GHODDOS Saman      -> PEDRI
--
-- OA FC (b4bf20e4-e454-4859-9dd7-c2ec55874ee9):
--   BELLEGARDE Jean-Ricner -> BELLINGHAM Jude
--   AIMAR SHER             -> JOAO NEVES
--
-- This is a retroactive MD2 presenter correction:
--   - xi_json_gw1 stays untouched for MD1.
--   - xi_json_gw2 is patched so MD2 scoring/view is correct.
--   - current xi_json is patched to the same corrected squad as the MD3
--     transfer-window starting point.
--   - transfers_used is kept unchanged because this is not a user MD3 move.
--   - only the two target entries' post-MD2 score rows are rebuilt from
--     canonical per-player score breakdowns already present in public.scores.

set statement_timeout = '5min';

do $$
declare
  v_boca constant uuid := 'a098a535-a561-428b-b978-b1ff413e6683';
  v_oa constant uuid := 'b4bf20e4-e454-4859-9dd7-c2ec55874ee9';
  v_started_at timestamptz := now();
  v_updated_entries int := 0;
  v_deleted_scores int := 0;
  v_inserted_scores int := 0;
  v_log_rows int := 0;
begin
  create temp table corrected_squads (
    entry_id uuid primary key,
    new_gw2 jsonb not null
  ) on commit drop;

  if (
    select count(*)
    from public.entries
    where id in (v_boca, v_oa)
      and team_name in ('Boca Seniors', 'OA FC')
      and coalesce(transfers_used, 0) = 0
      and jsonb_array_length(coalesce(xi_json_gw2, '[]'::jsonb)) = 12
  ) <> 2 then
    raise exception 'Expected Boca/OA curated entries with transfers_used=0 and 12-player GW2 snapshots';
  end if;

  if (
    select count(*)
    from public.entries e
    cross join lateral jsonb_array_elements(e.xi_json_gw2) as slot(player)
    where e.id = v_boca
      and slot.player->>'name' in ('LOGAN COSTA', 'GHODDOS Saman')
  ) <> 2 then
    raise exception 'Boca GW2 snapshot does not contain the expected outgoing players';
  end if;

  if (
    select count(*)
    from public.entries e
    cross join lateral jsonb_array_elements(e.xi_json_gw2) as slot(player)
    where e.id = v_oa
      and slot.player->>'name' in ('BELLEGARDE Jean-Ricner', 'AIMAR SHER')
  ) <> 2 then
    raise exception 'OA GW2 snapshot does not contain the expected outgoing players';
  end if;

  with canonical as (
    select
      (select to_jsonb(pp) from public.player_pool pp where pp.nation = 'Brazil' and pp.name = 'MARQUINHOS') as marquinhos,
      (select to_jsonb(pp) from public.player_pool pp where pp.nation = 'Spain' and pp.name = 'PEDRI') as pedri,
      (select to_jsonb(pp) from public.player_pool pp where pp.nation = 'England' and pp.name = 'BELLINGHAM Jude') as bellingham,
      (select to_jsonb(pp) from public.player_pool pp where pp.nation = 'Portugal' and pp.name = 'JOAO NEVES') as joao_neves
  ),
  patched as (
    select
      e.id as entry_id,
      jsonb_agg(
        case
          when e.id = v_boca and slot.ord - 1 = 2 then
            jsonb_build_object(
              'arab',        (c.marquinhos->>'arab')::boolean,
              'bucket',      'DEF',
              'category',    (c.marquinhos->>'category')::int,
              'club',        c.marquinhos->>'club',
              'name',        c.marquinhos->>'name',
              'nation',      c.marquinhos->>'nation',
              'nation_code', c.marquinhos->>'nation_code',
              'no',          (c.marquinhos->>'no')::int,
              'role',        'CB',
              'shirt_name',  c.marquinhos->>'shirt_name',
              'slot',        2,
              'tag',         'RCB',
              'wild',        false
            )
          when e.id = v_boca and slot.ord - 1 = 5 then
            jsonb_build_object(
              'arab',        (c.pedri->>'arab')::boolean,
              'bucket',      'MID',
              'category',    (c.pedri->>'category')::int,
              'club',        c.pedri->>'club',
              'name',        c.pedri->>'name',
              'nation',      c.pedri->>'nation',
              'nation_code', c.pedri->>'nation_code',
              'no',          (c.pedri->>'no')::int,
              'role',        'CM',
              'shirt_name',  c.pedri->>'shirt_name',
              'slot',        5,
              'tag',         'LCM',
              'wild',        false
            )
          when e.id = v_oa and slot.ord - 1 = 5 then
            jsonb_build_object(
              'arab',        (c.bellingham->>'arab')::boolean,
              'bucket',      'MID',
              'category',    (c.bellingham->>'category')::int,
              'club',        c.bellingham->>'club',
              'name',        c.bellingham->>'name',
              'nation',      c.bellingham->>'nation',
              'nation_code', c.bellingham->>'nation_code',
              'no',          (c.bellingham->>'no')::int,
              'role',        'CM',
              'shirt_name',  c.bellingham->>'shirt_name',
              'slot',        5,
              'tag',         'LCM',
              'wild',        false
            )
          when e.id = v_oa and slot.ord - 1 = 6 then
            jsonb_build_object(
              'arab',        (c.joao_neves->>'arab')::boolean,
              'bucket',      'MID',
              'category',    (c.joao_neves->>'category')::int,
              'club',        c.joao_neves->>'club',
              'name',        c.joao_neves->>'name',
              'nation',      c.joao_neves->>'nation',
              'nation_code', c.joao_neves->>'nation_code',
              'no',          (c.joao_neves->>'no')::int,
              'role',        'CM',
              'shirt_name',  c.joao_neves->>'shirt_name',
              'slot',        6,
              'tag',         'RCM',
              'wild',        false
            )
          else slot.player
        end
        order by slot.ord
      ) as new_gw2
    from public.entries e
    cross join canonical c
    cross join lateral jsonb_array_elements(e.xi_json_gw2) with ordinality as slot(player, ord)
    where e.id in (v_boca, v_oa)
      and c.marquinhos is not null
      and c.pedri is not null
      and c.bellingham is not null
      and c.joao_neves is not null
    group by e.id
  )
  insert into corrected_squads(entry_id, new_gw2)
  select entry_id, new_gw2
  from patched;

  if (select count(*) from corrected_squads) <> 2 then
    raise exception 'Failed to build both corrected squads';
  end if;

  if exists (
    select 1
    from corrected_squads cs
    where jsonb_array_length(cs.new_gw2) <> 12
  ) then
    raise exception 'Corrected squads must contain exactly 12 players';
  end if;

  if exists (
    select 1
    from corrected_squads cs
    cross join lateral jsonb_array_elements(cs.new_gw2) as slot(player)
    group by cs.entry_id
    having count(*) filter (where coalesce((slot.player->>'wild')::boolean, false)) <> 1
  ) then
    raise exception 'Corrected squads must contain exactly one wildcard';
  end if;

  if exists (
    select 1
    from corrected_squads cs
    cross join lateral jsonb_array_elements(cs.new_gw2) as slot(player)
    group by cs.entry_id
    having count(distinct (slot.player->>'nation') || chr(31) || (slot.player->>'name')) <> 12
  ) then
    raise exception 'Corrected squads cannot contain duplicate players';
  end if;

  if exists (
    select 1
    from corrected_squads cs
    cross join lateral jsonb_array_elements(cs.new_gw2) as slot(player)
    join public.player_pool pp
      on pp.nation = slot.player->>'nation'
     and pp.name = slot.player->>'name'
    group by cs.entry_id
    having count(*) filter (where pp.arab) < 1
  ) then
    raise exception 'Corrected squads must keep at least one Arab player';
  end if;

  if exists (
    select 1
    from (
      select cs.entry_id, slot.player->>'nation' as nation, count(*) as n
      from corrected_squads cs
      cross join lateral jsonb_array_elements(cs.new_gw2) as slot(player)
      group by cs.entry_id, slot.player->>'nation'
    ) counts
    where n > 3
  ) then
    raise exception 'Corrected squads cannot contain more than three players from one nation';
  end if;

  create temp table target_player_scores on commit drop as
  with selected_players as (
    select distinct slot.player->>'name' as player_name
    from corrected_squads cs
    cross join lateral jsonb_array_elements(cs.new_gw2) as slot(player)
    where not coalesce((slot.player->>'wild')::boolean, false)
  ),
  sampled as (
    select distinct on (pn.player_name, s.match_date)
      s.match_date,
      pn.player_name,
      stats
    from public.scores s
    cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as pn(player_name, stats)
    join selected_players sp on sp.player_name = pn.player_name
    where s.match_date >= date '2026-06-18'
    order by
      pn.player_name,
      s.match_date,
      case when s.entry_id in (v_boca, v_oa) then 1 else 0 end,
      s.entry_id
  )
  select *
  from sampled;

  execute 'alter table public.entries disable trigger guard_locked_entry_transfer_trg';

  update public.entries e
     set xi_json = cs.new_gw2,
         xi_json_gw2 = cs.new_gw2
  from corrected_squads cs
  where e.id = cs.entry_id;

  get diagnostics v_updated_entries = row_count;

  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';

  if v_updated_entries <> 2 then
    raise exception 'Expected to update exactly 2 entries, updated %', v_updated_entries;
  end if;

  update public.transfer_logs
     set event_type = 'admin_md2_presenter_correction'
   where entry_id in (v_boca, v_oa)
     and changed_at >= v_started_at
     and transfer_delta = 0
     and event_type = 'wildcard_swap';

  get diagnostics v_log_rows = row_count;

  delete from public.scores
   where entry_id in (v_boca, v_oa)
     and match_date >= date '2026-06-18';

  get diagnostics v_deleted_scores = row_count;

  with target_starters as (
    select
      cs.entry_id,
      slot.player->>'name' as player_name
    from corrected_squads cs
    cross join lateral jsonb_array_elements(cs.new_gw2) as slot(player)
    where not coalesce((slot.player->>'wild')::boolean, false)
  ),
  per_player as (
    select
      ts.entry_id,
      ps.match_date,
      ts.player_name,
      ps.stats,
      (
          coalesce((ps.stats->>'win')::int, 0)
        + coalesce((ps.stats->>'full90')::int, 0)
        + coalesce((ps.stats->>'goals')::int, 0)
        + coalesce((ps.stats->>'assists')::int, 0)
        + coalesce((ps.stats->>'cleanSheet')::int, 0)
        + coalesce((ps.stats->>'mvp')::int, 0)
        + coalesce((ps.stats->>'red')::int, 0)
      )::int as points
    from target_starters ts
    join target_player_scores ps
      on ps.player_name = ts.player_name
  ),
  by_entry_date as (
    select
      entry_id,
      match_date,
      sum(points)::int as points,
      jsonb_object_agg(player_name, stats order by player_name) as breakdown,
      bool_or(stats <> '{}'::jsonb) as has_visible_breakdown
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

  raise notice 'Boca/OA MD2 correction applied. entries=%, deleted_scores=%, rebuilt_scores=%, audit_logs=%',
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

with slots as (
  select
    e.id,
    e.team_name,
    e.transfers_used,
    'current' as squad,
    slot.ord - 1 as idx,
    slot.player->>'name' as player_name
  from public.entries e
  cross join lateral jsonb_array_elements(e.xi_json) with ordinality as slot(player, ord)
  where e.id in ('a098a535-a561-428b-b978-b1ff413e6683', 'b4bf20e4-e454-4859-9dd7-c2ec55874ee9')
    and slot.ord - 1 in (2, 5, 6)
  union all
  select
    e.id,
    e.team_name,
    e.transfers_used,
    'gw2' as squad,
    slot.ord - 1 as idx,
    slot.player->>'name' as player_name
  from public.entries e
  cross join lateral jsonb_array_elements(e.xi_json_gw2) with ordinality as slot(player, ord)
  where e.id in ('a098a535-a561-428b-b978-b1ff413e6683', 'b4bf20e4-e454-4859-9dd7-c2ec55874ee9')
    and slot.ord - 1 in (2, 5, 6)
)
select *
from slots
order by team_name, squad, idx;

select
  e.id,
  e.team_name,
  e.transfers_used,
  lt.total_points,
  e.rank_current
from public.entries e
left join public.leaderboard_totals lt on lt.entry_id = e.id
where e.id in ('a098a535-a561-428b-b978-b1ff413e6683', 'b4bf20e4-e454-4859-9dd7-c2ec55874ee9')
order by e.team_name;

select entry_id, match_date, points, breakdown
from public.scores
where entry_id in ('a098a535-a561-428b-b978-b1ff413e6683', 'b4bf20e4-e454-4859-9dd7-c2ec55874ee9')
  and match_date >= date '2026-06-18'
order by entry_id, match_date;
