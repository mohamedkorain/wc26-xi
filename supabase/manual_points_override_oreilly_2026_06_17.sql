-- One-off production correction:
-- England-Croatia, 2026-06-17, fixture 1489384.
--
-- OREILLY Nico played 90 minutes and England won 4-2.
-- Fantasy points owed:
--   win    +1
--   full90 +1
--   total  +2
--
-- No clean sheet because England conceded 2.
--
-- Idempotent:
--   - applies only to valid MD1 non-wildcard OREILLY Nico starters submitted
--     before kickoff
--   - adds only missing win/full90 keys
--   - inserts a score row when OREILLY Nico was the entry's only scorer
--   - refreshes player leaderboard + entry leaderboard/ranks

with oreilly_entries as (
  select distinct e.id as entry_id
  from public.entries e
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw1, e.xi_json, '[]'::jsonb)) as slot
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-17T20:00:00Z'::timestamptz
    and slot->>'name' = 'OREILLY Nico'
    and coalesce((slot->>'wild')::boolean, false) = false
),
target as (
  select
    s.entry_id,
    s.breakdown,
    s.points,
    coalesce((s.breakdown->'OREILLY Nico'->>'win')::int, 0) as old_win,
    coalesce((s.breakdown->'OREILLY Nico'->>'full90')::int, 0) as old_full90
  from public.scores s
  join oreilly_entries oe on oe.entry_id = s.entry_id
  where s.match_date = '2026-06-17'
),
patched as (
  select
    entry_id,
    jsonb_set(
      breakdown,
      array['OREILLY Nico'],
      coalesce(breakdown->'OREILLY Nico', '{}'::jsonb) || '{"win":1,"full90":1}'::jsonb,
      true
    ) as new_breakdown,
    points
      + case when old_win = 1 then 0 else 1 end
      + case when old_full90 = 1 then 0 else 1 end as new_points
  from target
  where old_win <> 1 or old_full90 <> 1
)
update public.scores s
set
  breakdown = p.new_breakdown,
  points = p.new_points
from patched p
where s.entry_id = p.entry_id
  and s.match_date = '2026-06-17';

with oreilly_entries as (
  select distinct e.id as entry_id
  from public.entries e
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw1, e.xi_json, '[]'::jsonb)) as slot
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-17T20:00:00Z'::timestamptz
    and slot->>'name' = 'OREILLY Nico'
    and coalesce((slot->>'wild')::boolean, false) = false
)
insert into public.scores (entry_id, match_date, points, breakdown)
select
  oe.entry_id,
  '2026-06-17'::date,
  2,
  '{"OREILLY Nico":{"win":1,"full90":1}}'::jsonb
from oreilly_entries oe
where not exists (
  select 1
  from public.scores s
  where s.entry_id = oe.entry_id
    and s.match_date = '2026-06-17'
);

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

select
  player_name,
  matches,
  mvps,
  total_points
from public.player_leaderboard
where player_name in ('OREILLY Nico', 'SEMENYO Antoine')
order by player_name;
