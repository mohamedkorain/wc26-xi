-- One-off production correction:
-- Jordan-Algeria, 2026-06-23, fixture 1489400.
--
-- Production ruling from Mohamed:
-- MVP point belongs to Algeria CM MAZA Ibrahim, not BENSEBAINI Ramy.
--
-- This fixture is before MD3 kickoff, so eligibility uses the frozen MD2
-- squad snapshot (`xi_json_gw2`), exactly like score-day.
--
-- Idempotent:
--   - removes only an existing mvp key from BENSEBAINI Ramy
--   - adds mvp: 1 to MAZA Ibrahim for entries that had him as a non-wildcard
--     MD2 starter and existed before kickoff
--   - inserts a 2026-06-23 score row if Maza is the entry's only point
--   - adjusts scores.points by the exact per-entry delta
--   - refreshes player leaderboard + entry leaderboard/ranks

with maza_entries as (
  select distinct e.id as entry_id
  from public.entries e
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw2, '[]'::jsonb)) as slot(player)
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-23T03:00:00Z'::timestamptz
    and slot.player->>'name' = 'MAZA Ibrahim'
    and coalesce((slot.player->>'wild')::boolean, false) = false
),
target as (
  select
    s.entry_id,
    s.breakdown,
    s.points,
    coalesce((s.breakdown->'BENSEBAINI Ramy'->>'mvp')::int, 0) = 1 as bensebaini_had_mvp,
    me.entry_id is not null as has_maza,
    coalesce((s.breakdown->'MAZA Ibrahim'->>'mvp')::int, 0) = 1 as maza_had_mvp
  from public.scores s
  left join maza_entries me on me.entry_id = s.entry_id
  where s.match_date = '2026-06-23'
    and (s.breakdown ? 'BENSEBAINI Ramy' or me.entry_id is not null)
),
stripped as (
  select
    entry_id,
    points,
    bensebaini_had_mvp,
    has_maza,
    maza_had_mvp,
    case
      when bensebaini_had_mvp and ((breakdown->'BENSEBAINI Ramy') - 'mvp') = '{}'::jsonb then
        breakdown - 'BENSEBAINI Ramy'
      when bensebaini_had_mvp then
        jsonb_set(breakdown, array['BENSEBAINI Ramy'], (breakdown->'BENSEBAINI Ramy') - 'mvp', true)
      else breakdown
    end as without_bensebaini
  from target
),
patched as (
  select
    entry_id,
    case
      when has_maza and not maza_had_mvp then
        jsonb_set(
          without_bensebaini,
          array['MAZA Ibrahim'],
          coalesce(without_bensebaini->'MAZA Ibrahim', '{}'::jsonb) || '{"mvp":1}'::jsonb,
          true
        )
      else without_bensebaini
    end as new_breakdown,
    points
      - case when bensebaini_had_mvp then 1 else 0 end
      + case when has_maza and not maza_had_mvp then 1 else 0 end as new_points
  from stripped
  where bensebaini_had_mvp or (has_maza and not maza_had_mvp)
)
update public.scores s
set
  breakdown = p.new_breakdown,
  points = p.new_points
from patched p
where s.entry_id = p.entry_id
  and s.match_date = '2026-06-23';

with maza_entries as (
  select distinct e.id as entry_id
  from public.entries e
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw2, '[]'::jsonb)) as slot(player)
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-23T03:00:00Z'::timestamptz
    and slot.player->>'name' = 'MAZA Ibrahim'
    and coalesce((slot.player->>'wild')::boolean, false) = false
)
insert into public.scores (entry_id, match_date, points, breakdown)
select
  me.entry_id,
  '2026-06-23'::date,
  1,
  '{"MAZA Ibrahim":{"mvp":1}}'::jsonb
from maza_entries me
where not exists (
  select 1
  from public.scores s
  where s.entry_id = me.entry_id
    and s.match_date = '2026-06-23'
);

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- Verification helper: should show MAZA Ibrahim with MVPs and
-- BENSEBAINI Ramy with zero 2026-06-23 MVP rows after the patch.
select
  player_name,
  matches,
  mvps,
  total_points
from public.player_leaderboard
where player_name in ('MAZA Ibrahim', 'BENSEBAINI Ramy')
order by player_name;

select
  b.player_name,
  count(*) as score_rows,
  sum(coalesce((b.stats->>'mvp')::int, 0)) as mvp_flags
from public.scores s
cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(player_name, stats)
where s.match_date = '2026-06-23'
  and b.player_name in ('MAZA Ibrahim', 'BENSEBAINI Ramy')
group by b.player_name
order by b.player_name;
