-- One-off production correction:
-- Australia-Turkiye, 2026-06-14, fixture 1539001.
--
-- ONEILL Aiden started for Australia in the 2-0 win over Turkiye and was
-- missed by the scoring feed.
-- Fantasy points owed:
--   win         +1
--   full90      +1
--   cleanSheet  +1
--   total       +3
--
-- Eligibility:
--   - entry was submitted before the MD1 deadline:
--       2026-06-11 19:00 UTC = 22:00 Cairo
--   - ONEILL Aiden was in the locked MD1 starting XI
--   - wildcard bench selections do not score
--   - current xi_json fallback is allowed only for entries with no GW1
--     snapshot and no transfer log, meaning current XI is still original MD1
--
-- Idempotent:
--   - adds only missing win/full90/cleanSheet keys
--   - inserts a score row when O'Neill was the entry's only scorer
--   - refreshes player leaderboard + entry leaderboard/ranks

set statement_timeout = '5min';

drop table if exists pg_temp.oneill_md1_entries;
create temp table oneill_md1_entries on commit drop as
with md1_candidates as (
  select
    e.id as entry_id,
    case
      when e.xi_json_gw1 is not null then e.xi_json_gw1
      when not exists (
        select 1
        from public.transfer_logs tl
        where tl.entry_id = e.id
      ) then e.xi_json
      else '[]'::jsonb
    end as md1_xi
  from public.entries e
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-11T19:00:00Z'::timestamptz
)
select distinct c.entry_id
from md1_candidates c
cross join lateral jsonb_array_elements(coalesce(c.md1_xi, '[]'::jsonb)) as slot
where slot->>'name' = 'ONEILL Aiden'
  and coalesce((slot->>'wild')::boolean, false) = false;

with target as (
  select
    s.entry_id,
    coalesce(s.breakdown, '{}'::jsonb) as breakdown,
    s.points,
    coalesce((s.breakdown->'ONEILL Aiden'->>'win')::int, 0) as old_win,
    coalesce((s.breakdown->'ONEILL Aiden'->>'full90')::int, 0) as old_full90,
    coalesce((s.breakdown->'ONEILL Aiden'->>'cleanSheet')::int, 0) as old_clean_sheet
  from public.scores s
  join pg_temp.oneill_md1_entries oe on oe.entry_id = s.entry_id
  where s.match_date = '2026-06-14'
),
patched as (
  select
    entry_id,
    jsonb_set(
      breakdown,
      array['ONEILL Aiden'],
      coalesce(breakdown->'ONEILL Aiden', '{}'::jsonb)
        || '{"win":1,"full90":1,"cleanSheet":1}'::jsonb,
      true
    ) as new_breakdown,
    points
      + case when old_win = 1 then 0 else 1 end
      + case when old_full90 = 1 then 0 else 1 end
      + case when old_clean_sheet = 1 then 0 else 1 end as new_points
  from target
  where old_win <> 1 or old_full90 <> 1 or old_clean_sheet <> 1
),
updated as (
  update public.scores s
  set
    breakdown = p.new_breakdown,
    points = p.new_points
  from patched p
  where s.entry_id = p.entry_id
    and s.match_date = '2026-06-14'
  returning s.entry_id
)
select count(*) as updated_score_rows
from updated;

with inserted as (
  insert into public.scores (entry_id, match_date, points, breakdown)
  select
    oe.entry_id,
    '2026-06-14'::date,
    3,
    '{"ONEILL Aiden":{"win":1,"full90":1,"cleanSheet":1}}'::jsonb
  from pg_temp.oneill_md1_entries oe
  where not exists (
    select 1
    from public.scores s
    where s.entry_id = oe.entry_id
      and s.match_date = '2026-06-14'
  )
  returning entry_id
)
select count(*) as inserted_score_rows
from inserted;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

select count(*) as eligible_oneill_md1_entries
from pg_temp.oneill_md1_entries;

select
  player_name,
  matches,
  mvps,
  total_points
from public.player_leaderboard
where player_name = 'ONEILL Aiden';

select
  count(*) as oneill_scored_rows,
  sum(points) filter (where breakdown ? 'ONEILL Aiden') as rows_total_points
from public.scores
where match_date = '2026-06-14'
  and breakdown ? 'ONEILL Aiden';
