-- Presenter/admin mini-league MD1 override.
--
-- Context:
--   These 8 entries are curated into the HALLO AMRIKA mini leaderboard and
--   should all score from MD1. One of them was submitted after MD1 started,
--   so the normal late-entry gate skipped earlier matches.
--
-- What this does:
--   - Targets only the 8 known mini-leaderboard entry IDs.
--   - Makes each target MD1-eligible by capping submitted_at at one minute
--     before the opener kickoff.
--   - Preserves each target's intended GW1 lineup by setting xi_json_gw1 to
--     the current xi_json only where no GW1 snapshot exists.
--   - Rebuilds only these 8 entries' score rows from the canonical per-player
--     score breakdowns already stored in public.scores.
--   - Refreshes player leaderboard + entry leaderboard/ranks.
--
-- Run in Supabase SQL Editor.

set statement_timeout = '5min';

drop table if exists pg_temp.mini_md1_targets;
create temp table mini_md1_targets (
  entry_id uuid primary key,
  label text not null
) on commit drop;

insert into mini_md1_targets (entry_id, label) values
  ('a098a535-a561-428b-b978-b1ff413e6683', 'Boca Seniors'),
  ('b4bf20e4-e454-4859-9dd7-c2ec55874ee9', 'OA FC'),
  ('06f4870f-9cc9-408e-aa10-b744ab2acf08', 'Chuice'),
  ('550eed0a-73c3-44c0-8478-03ff9797f1c0', 'Kas3alm'),
  ('f9ced3d7-7ab8-4e09-81c0-b01e74644f79', 'Kikso'),
  ('1ae17874-1b08-4b08-a54c-122f3d87b676', 'الإسكندر ديل بيرو'),
  ('d8089b80-3ce9-45c5-b94f-f8f90c6e205d', 'Khairallax'),
  ('e6613d8c-ac16-4bf6-81d5-bae433394ee2', 'Marios');

do $$
declare
  v_found int;
  v_updated int;
begin
  select count(*)
    into v_found
  from public.entries e
  join pg_temp.mini_md1_targets t on t.entry_id = e.id;

  if v_found <> 8 then
    raise exception 'Expected 8 mini-league entries, found %', v_found;
  end if;

  -- These are admin/presenter corrections. Disable only the entry-write
  -- guard/validator around this metadata+snapshot maintenance update.
  execute 'alter table public.entries disable trigger guard_locked_entry_transfer_trg';
  execute 'alter table public.entries disable trigger validate_entry_lineup_write_trg';

  update public.entries e
     set submitted_at = least(e.submitted_at, timestamptz '2026-06-11 18:59:00+00'),
         xi_json_gw1 = coalesce(e.xi_json_gw1, e.xi_json),
         transfers_used = coalesce(e.transfers_used, 0)
    from pg_temp.mini_md1_targets t
   where t.entry_id = e.id;

  get diagnostics v_updated = row_count;

  execute 'alter table public.entries enable trigger validate_entry_lineup_write_trg';
  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';

  if v_updated <> 8 then
    raise exception 'Expected to update 8 mini-league entries, updated %', v_updated;
  end if;
exception
  when others then
    begin
      execute 'alter table public.entries enable trigger validate_entry_lineup_write_trg';
    exception when others then
      null;
    end;
    begin
      execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
    exception when others then
      null;
    end;
    raise;
end $$;

-- Capture canonical per-player/date score stats BEFORE deleting target rows.
drop table if exists pg_temp.mini_md1_player_scores;
create temp table mini_md1_player_scores on commit drop as
with target_starters as (
  select distinct slot.player->>'name' as player_name
  from public.entries e
  join pg_temp.mini_md1_targets t on t.entry_id = e.id
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw1, e.xi_json, '[]'::jsonb)) as slot(player)
  where not coalesce((slot.player->>'wild')::boolean, false)
),
sampled as (
  select distinct on (pn.player_name, s.match_date)
    s.match_date,
    pn.player_name,
    pn.stats
  from public.scores s
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as pn(player_name, stats)
  join target_starters ts on ts.player_name = pn.player_name
  where s.match_date >= date '2026-06-11'
  order by pn.player_name, s.match_date, s.entry_id
)
select *
from sampled;

delete from public.scores s
using pg_temp.mini_md1_targets t
where s.entry_id = t.entry_id
  and s.match_date >= date '2026-06-11';

with target_starters as (
  select
    e.id as entry_id,
    slot.player->>'name' as player_name
  from public.entries e
  join pg_temp.mini_md1_targets t on t.entry_id = e.id
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw1, e.xi_json, '[]'::jsonb)) as slot(player)
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
      - case when ps.stats ? 'red' then 1 else 0 end
    )::int as points
  from target_starters ts
  join pg_temp.mini_md1_player_scores ps
    on ps.player_name = ts.player_name
),
by_date as (
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
from by_date
on conflict (entry_id, match_date)
do update set
  points = excluded.points,
  breakdown = excluded.breakdown;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- Verification summary.
select
  e.team_name,
  e.submitted_at,
  e.xi_json_gw1 is not null as has_gw1_snapshot,
  coalesce(lt.total_points, 0) as total_points,
  coalesce(count(s.match_date), 0)::int as score_rows,
  coalesce(jsonb_object_agg(s.match_date::text, s.points order by s.match_date)
    filter (where s.match_date is not null), '{}'::jsonb) as points_by_date
from pg_temp.mini_md1_targets t
join public.entries e on e.id = t.entry_id
left join public.leaderboard_totals lt on lt.entry_id = e.id
left join public.scores s on s.entry_id = e.id
group by e.team_name, e.submitted_at, e.xi_json_gw1, lt.total_points
order by coalesce(lt.total_points, 0) desc, e.submitted_at asc;
