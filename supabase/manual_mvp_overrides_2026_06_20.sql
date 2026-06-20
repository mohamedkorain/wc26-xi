-- Manual MVP overrides for 2026-06-20 fixtures.
--
-- Mohamed rulings:
--   - Brazil 3-0 Haiti: VINICIUS JUNIOR, not MATHEUS CUNHA.
--   - Turkey 0-1 Paraguay: GALARZA Matias, not CACERES Juan Jose.
--
-- Scores are stored one row per entry per date, with a merged JSON breakdown.
-- This patch is idempotent: it only removes existing old MVP flags and only
-- adds new MVP flags where missing.

with base as (
  select
    entry_id,
    match_date,
    points,
    breakdown,
    coalesce((breakdown->'MATHEUS CUNHA'->>'mvp')::int, 0) > 0 as cunha_old_mvp,
    (breakdown ? 'VINICIUS JUNIOR')
      and coalesce((breakdown->'VINICIUS JUNIOR'->>'mvp')::int, 0) = 0 as vini_new_mvp,
    coalesce((breakdown->'CACERES Juan Jose'->>'mvp')::int, 0) > 0 as caceres_old_mvp,
    (breakdown ? 'GALARZA Matias')
      and coalesce((breakdown->'GALARZA Matias'->>'mvp')::int, 0) = 0 as galarza_new_mvp
  from public.scores
  where match_date = date '2026-06-20'
    and breakdown ?| array[
      'MATHEUS CUNHA',
      'VINICIUS JUNIOR',
      'CACERES Juan Jose',
      'GALARZA Matias'
    ]
),
b1 as (
  select
    *,
    case
      when cunha_old_mvp then
        jsonb_set(breakdown, array['MATHEUS CUNHA'], (breakdown->'MATHEUS CUNHA') - 'mvp')
      else breakdown
    end as j1
  from base
),
b2 as (
  select
    *,
    case
      when vini_new_mvp then
        jsonb_set(j1, array['VINICIUS JUNIOR'], (j1->'VINICIUS JUNIOR') || '{"mvp":1}'::jsonb)
      else j1
    end as j2
  from b1
),
b3 as (
  select
    *,
    case
      when caceres_old_mvp then
        jsonb_set(j2, array['CACERES Juan Jose'], (j2->'CACERES Juan Jose') - 'mvp')
      else j2
    end as j3
  from b2
),
b4 as (
  select
    *,
    case
      when galarza_new_mvp then
        jsonb_set(j3, array['GALARZA Matias'], (j3->'GALARZA Matias') || '{"mvp":1}'::jsonb)
      else j3
    end as new_breakdown
  from b3
),
patched as (
  select
    entry_id,
    match_date,
    points
      - case when cunha_old_mvp then 1 else 0 end
      + case when vini_new_mvp then 1 else 0 end
      - case when caceres_old_mvp then 1 else 0 end
      + case when galarza_new_mvp then 1 else 0 end as new_points,
    new_breakdown
  from b4
  where cunha_old_mvp or vini_new_mvp or caceres_old_mvp or galarza_new_mvp
)
update public.scores s
set points = p.new_points,
    breakdown = p.new_breakdown
from patched p
where s.entry_id = p.entry_id
  and s.match_date = p.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

select
  key as player_name,
  count(*) as owned_count,
  count(*) filter (where coalesce((value->>'mvp')::int, 0) > 0) as mvp_count
from public.scores s
cross join lateral jsonb_each(s.breakdown) e(key, value)
where s.match_date = date '2026-06-20'
  and key in ('MATHEUS CUNHA','VINICIUS JUNIOR','CACERES Juan Jose','GALARZA Matias')
group by key
order by key;
