-- One-off production correction:
-- Ghana-Panama, 2026-06-17, fixture 1489385.
--
-- API-Football rating selected ZIGI Lawrence Ati as MVP. Production ruling:
-- MVP point belongs to SEMENYO Antoine.
--
-- Idempotent:
--   - removes only an existing mvp key from ZIGI Lawrence Ati
--   - adds mvp: 1 to SEMENYO Antoine only for entries that had him as a
--     non-wildcard MD1 starter and existed before kickoff
--   - adjusts scores.points by the exact per-entry delta
--   - refreshes player leaderboard + entry leaderboard/ranks

with sem_entries as (
  select distinct e.id as entry_id
  from public.entries e
  cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw1, e.xi_json, '[]'::jsonb)) as slot
  where e.league_id = '11111111-1111-1111-1111-111111111111'
    and e.submitted_at <= '2026-06-17T23:00:00Z'::timestamptz
    and slot->>'name' = 'SEMENYO Antoine'
    and coalesce((slot->>'wild')::boolean, false) = false
),
target as (
  select
    s.entry_id,
    s.breakdown,
    s.points,
    coalesce((s.breakdown->'ZIGI Lawrence Ati'->>'mvp')::int, 0) = 1 as zigi_had_mvp,
    se.entry_id is not null as has_semenyo,
    coalesce((s.breakdown->'SEMENYO Antoine'->>'mvp')::int, 0) = 1 as sem_had_mvp
  from public.scores s
  left join sem_entries se on se.entry_id = s.entry_id
  where s.match_date = '2026-06-17'
    and (s.breakdown ? 'ZIGI Lawrence Ati' or se.entry_id is not null)
),
stripped as (
  select
    entry_id,
    points,
    zigi_had_mvp,
    has_semenyo,
    sem_had_mvp,
    case
      when zigi_had_mvp and ((breakdown->'ZIGI Lawrence Ati') - 'mvp') = '{}'::jsonb then
        breakdown - 'ZIGI Lawrence Ati'
      when zigi_had_mvp then
        jsonb_set(breakdown, array['ZIGI Lawrence Ati'], (breakdown->'ZIGI Lawrence Ati') - 'mvp', true)
      else breakdown
    end as without_zigi
  from target
),
patched as (
  select
    entry_id,
    case
      when has_semenyo and not sem_had_mvp then
        jsonb_set(
          without_zigi,
          array['SEMENYO Antoine'],
          coalesce(without_zigi->'SEMENYO Antoine', '{}'::jsonb) || '{"mvp":1}'::jsonb,
          true
        )
      else without_zigi
    end as new_breakdown,
    points
      - case when zigi_had_mvp then 1 else 0 end
      + case when has_semenyo and not sem_had_mvp then 1 else 0 end as new_points
  from stripped
  where zigi_had_mvp or (has_semenyo and not sem_had_mvp)
)
update public.scores s
set
  breakdown = p.new_breakdown,
  points = p.new_points
from patched p
where s.entry_id = p.entry_id
  and s.match_date = '2026-06-17';

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- Verification helper: should show SEMENYO Antoine with MVPs and
-- ZIGI Lawrence Ati with zero MVPs after the patch.
select
  player_name,
  matches,
  mvps,
  total_points
from public.player_leaderboard
where player_name in ('SEMENYO Antoine', 'ZIGI Lawrence Ati')
order by player_name;
