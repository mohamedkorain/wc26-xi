-- One-off production correction:
-- Qatar-Switzerland, 2026-06-13, fixture 1489373.
--
-- Production ruling from Mohamed:
-- MVP point belongs to Qatar GK MAHMOUD ABUNADA, not VARGAS Ruben.
--
-- Match ended 1-1, so Abunada receives only the MVP point:
-- no win, no full-90 win bonus, no clean sheet.
--
-- Idempotent:
--   - removes only an existing mvp key from VARGAS Ruben
--   - adds mvp: 1 to MAHMOUD ABUNADA for entries that had him as a
--     non-wildcard starter and existed before kickoff
--   - inserts a 2026-06-13 score row if Abunada is the entry's only point
--   - adjusts scores.points by the exact per-entry delta
--   - refreshes player leaderboard + entry leaderboard/ranks

with abunada_entries as (
  select distinct e.id as entry_id
  from public.entries e
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw1, e.xi_json, '[]'::jsonb)) as slot
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-13T19:00:00Z'::timestamptz
    and slot->>'name' = 'MAHMOUD ABUNADA'
    and coalesce((slot->>'wild')::boolean, false) = false
),
target as (
  select
    s.entry_id,
    s.breakdown,
    s.points,
    coalesce((s.breakdown->'VARGAS Ruben'->>'mvp')::int, 0) = 1 as vargas_had_mvp,
    ae.entry_id is not null as has_abunada,
    coalesce((s.breakdown->'MAHMOUD ABUNADA'->>'mvp')::int, 0) = 1 as abunada_had_mvp
  from public.scores s
  left join abunada_entries ae on ae.entry_id = s.entry_id
  where s.match_date = '2026-06-13'
    and (s.breakdown ? 'VARGAS Ruben' or ae.entry_id is not null)
),
stripped as (
  select
    entry_id,
    points,
    vargas_had_mvp,
    has_abunada,
    abunada_had_mvp,
    case
      when vargas_had_mvp and ((breakdown->'VARGAS Ruben') - 'mvp') = '{}'::jsonb then
        breakdown - 'VARGAS Ruben'
      when vargas_had_mvp then
        jsonb_set(breakdown, array['VARGAS Ruben'], (breakdown->'VARGAS Ruben') - 'mvp', true)
      else breakdown
    end as without_vargas
  from target
),
patched as (
  select
    entry_id,
    case
      when has_abunada and not abunada_had_mvp then
        jsonb_set(
          without_vargas,
          array['MAHMOUD ABUNADA'],
          coalesce(without_vargas->'MAHMOUD ABUNADA', '{}'::jsonb) || '{"mvp":1}'::jsonb,
          true
        )
      else without_vargas
    end as new_breakdown,
    points
      - case when vargas_had_mvp then 1 else 0 end
      + case when has_abunada and not abunada_had_mvp then 1 else 0 end as new_points
  from stripped
  where vargas_had_mvp or (has_abunada and not abunada_had_mvp)
)
update public.scores s
set
  breakdown = p.new_breakdown,
  points = p.new_points
from patched p
where s.entry_id = p.entry_id
  and s.match_date = '2026-06-13';

with abunada_entries as (
  select distinct e.id as entry_id
  from public.entries e
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw1, e.xi_json, '[]'::jsonb)) as slot
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-13T19:00:00Z'::timestamptz
    and slot->>'name' = 'MAHMOUD ABUNADA'
    and coalesce((slot->>'wild')::boolean, false) = false
)
insert into public.scores (entry_id, match_date, points, breakdown)
select
  ae.entry_id,
  '2026-06-13'::date,
  1,
  '{"MAHMOUD ABUNADA":{"mvp":1}}'::jsonb
from abunada_entries ae
where not exists (
  select 1
  from public.scores s
  where s.entry_id = ae.entry_id
    and s.match_date = '2026-06-13'
);

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- Verification helper: should show MAHMOUD ABUNADA with MVPs and
-- VARGAS Ruben with zero MVPs after the patch.
select
  player_name,
  matches,
  mvps,
  total_points
from public.player_leaderboard
where player_name in ('MAHMOUD ABUNADA', 'VARGAS Ruben')
order by player_name;
