-- One-off production correction:
-- Germany-Curacao, 2026-06-14, fixture 1489374.
--
-- API-Football rating selected UNDAV Deniz as MVP. Production ruling:
-- MVP point belongs to HAVERTZ Kai.
--
-- Idempotent:
--   - removes only an existing mvp key from UNDAV Deniz
--   - adds mvp: 1 to HAVERTZ Kai only for entries that have him
--   - adjusts scores.points by the exact per-entry delta
--   - refreshes player leaderboard + entry leaderboard/ranks

with target as (
  select
    entry_id,
    breakdown,
    points,
    coalesce((breakdown->'UNDAV Deniz'->>'mvp')::int, 0) = 1 as undav_had_mvp,
    breakdown ? 'HAVERTZ Kai' as has_havertz,
    coalesce((breakdown->'HAVERTZ Kai'->>'mvp')::int, 0) = 1 as havertz_had_mvp
  from public.scores
  where match_date = '2026-06-14'
    and (breakdown ? 'UNDAV Deniz' or breakdown ? 'HAVERTZ Kai')
),
patched as (
  select
    entry_id,
    case
      when has_havertz and not havertz_had_mvp then
        jsonb_set(
          case
            when undav_had_mvp then
              jsonb_set(breakdown, array['UNDAV Deniz'], (breakdown->'UNDAV Deniz') - 'mvp', true)
            else breakdown
          end,
          array['HAVERTZ Kai'],
          coalesce(breakdown->'HAVERTZ Kai', '{}'::jsonb) || '{"mvp":1}'::jsonb,
          true
        )
      when undav_had_mvp then
        jsonb_set(breakdown, array['UNDAV Deniz'], (breakdown->'UNDAV Deniz') - 'mvp', true)
      else breakdown
    end as new_breakdown,
    points
      - case when undav_had_mvp then 1 else 0 end
      + case when has_havertz and not havertz_had_mvp then 1 else 0 end as new_points
  from target
  where undav_had_mvp or (has_havertz and not havertz_had_mvp)
)
update public.scores s
set
  breakdown = p.new_breakdown,
  points = p.new_points
from patched p
where s.entry_id = p.entry_id
  and s.match_date = '2026-06-14';

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- Verification helper: should show HAVERTZ Kai with more MVPs and UNDAV Deniz
-- with zero MVPs after the patch.
select
  player_name,
  mvps,
  total_points
from public.player_leaderboard
where player_name in ('HAVERTZ Kai', 'UNDAV Deniz')
order by player_name;
