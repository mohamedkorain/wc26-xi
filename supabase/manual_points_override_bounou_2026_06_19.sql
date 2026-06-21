-- One-off production correction:
-- Scotland-Morocco, 2026-06-19, fixture 1489390.
--
-- BOUNOU Yassine played in Morocco's 1-0 win and was missed by scoring.
-- Fantasy points owed:
--   win         +1
--   full90      +1
--   cleanSheet  +1
--   total       +3
--
-- Idempotent:
--   - applies only to valid MD2 non-wildcard BOUNOU Yassine starters
--     submitted before fixture kickoff
--   - adds only missing win/full90/cleanSheet keys
--   - inserts a score row when Bounou was the entry's only scorer
--   - refreshes player leaderboard + entry leaderboard/ranks

with bounou_entries as (
  select distinct e.id as entry_id
  from public.entries e
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw2, '[]'::jsonb)) as slot
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-19T22:00:00Z'::timestamptz
    and slot->>'name' = 'BOUNOU Yassine'
    and coalesce((slot->>'wild')::boolean, false) = false
),
target as (
  select
    s.entry_id,
    s.breakdown,
    s.points,
    coalesce((s.breakdown->'BOUNOU Yassine'->>'win')::int, 0) as old_win,
    coalesce((s.breakdown->'BOUNOU Yassine'->>'full90')::int, 0) as old_full90,
    coalesce((s.breakdown->'BOUNOU Yassine'->>'cleanSheet')::int, 0) as old_clean_sheet
  from public.scores s
  join bounou_entries be on be.entry_id = s.entry_id
  where s.match_date = '2026-06-19'
),
patched as (
  select
    entry_id,
    jsonb_set(
      breakdown,
      array['BOUNOU Yassine'],
      coalesce(breakdown->'BOUNOU Yassine', '{}'::jsonb)
        || '{"win":1,"full90":1,"cleanSheet":1}'::jsonb,
      true
    ) as new_breakdown,
    points
      + case when old_win = 1 then 0 else 1 end
      + case when old_full90 = 1 then 0 else 1 end
      + case when old_clean_sheet = 1 then 0 else 1 end as new_points
  from target
  where old_win <> 1 or old_full90 <> 1 or old_clean_sheet <> 1
)
update public.scores s
set
  breakdown = p.new_breakdown,
  points = p.new_points
from patched p
where s.entry_id = p.entry_id
  and s.match_date = '2026-06-19';

with bounou_entries as (
  select distinct e.id as entry_id
  from public.entries e
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw2, '[]'::jsonb)) as slot
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-19T22:00:00Z'::timestamptz
    and slot->>'name' = 'BOUNOU Yassine'
    and coalesce((slot->>'wild')::boolean, false) = false
)
insert into public.scores (entry_id, match_date, points, breakdown)
select
  be.entry_id,
  '2026-06-19'::date,
  3,
  '{"BOUNOU Yassine":{"win":1,"full90":1,"cleanSheet":1}}'::jsonb
from bounou_entries be
where not exists (
  select 1
  from public.scores s
  where s.entry_id = be.entry_id
    and s.match_date = '2026-06-19'
);

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

select
  player_name,
  matches,
  mvps,
  total_points
from public.player_leaderboard
where player_name in ('BOUNOU Yassine')
order by player_name;
