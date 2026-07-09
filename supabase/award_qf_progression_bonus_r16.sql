-- Quarter-final qualification bonus.
--
-- Rule (confirmed 2026-07-09):
--   - qf: 3 per locked R16 starter whose nation advanced to the quarter-finals
--   - source squad: entries.xi_json_r16 (the frozen R16 scoring squad)
--   - wildcard bench and empty/dead slots excluded
--   - eligibility: submitted before the R16 deadline (2026-07-04 16:00 UTC)
--   - the bonus is booked on the R16 match_date the nation qualified through,
--     mirroring how r32/r16 progression bonuses were booked on the qualifying
--     round's match date.
--
-- Note: the QF bonus is 3 points, unlike the R32 and R16 bonuses which were 2.
--
-- Idempotent: only adds qf:3 where it is not already present.

set statement_timeout = '5min';

create temporary table tmp_qf_qualified_nations (
  nation text primary key,
  match_date date not null
) on commit drop;

insert into tmp_qf_qualified_nations (nation, match_date) values
  ('France',      '2026-07-04'),
  ('Morocco',     '2026-07-04'),
  ('Norway',      '2026-07-05'),
  ('England',     '2026-07-06'),
  ('Spain',       '2026-07-06'),
  ('Argentina',   '2026-07-07'),
  ('Switzerland', '2026-07-07'),
  ('Belgium',     '2026-07-07');

create temporary table tmp_qf_bonus_eligible on commit drop as
select
  e.id as entry_id,
  q.match_date,
  x.player->>'name' as player_name
from public.entries e
cross join lateral jsonb_array_elements(coalesce(e.xi_json_r16, e.xi_json, '[]'::jsonb)) as x(player)
join tmp_qf_qualified_nations q on q.nation = x.player->>'nation'
where e.league_id = '11111111-1111-1111-1111-111111111111'
  and e.submitted_at <= '2026-07-04 16:00:00+00'::timestamptz
  and not coalesce((x.player->>'wild')::boolean, false)
  and not coalesce((x.player->>'empty')::boolean, false)
  and x.player->>'name' is not null;

create index on tmp_qf_bonus_eligible (entry_id, match_date);

-- Add qf:3 to existing score rows.
with existing_add as (
  select
    s.entry_id, s.match_date,
    jsonb_object_agg(
      e.player_name,
      coalesce(s.breakdown->e.player_name, '{}'::jsonb) || jsonb_build_object('qf', 3)
    ) as patch_breakdown,
    (count(*) * 3)::int as added_points
  from public.scores s
  join tmp_qf_bonus_eligible e on e.entry_id = s.entry_id and e.match_date = s.match_date
  where coalesce((s.breakdown->e.player_name->>'qf')::int, 0) = 0
  group by s.entry_id, s.match_date
)
update public.scores s
   set breakdown = coalesce(s.breakdown, '{}'::jsonb) || existing_add.patch_breakdown,
       points = s.points + existing_add.added_points
from existing_add
where s.entry_id = existing_add.entry_id and s.match_date = existing_add.match_date;

-- Insert new score rows for eligible owners with no row on the date.
insert into public.scores (entry_id, match_date, points, breakdown)
select
  e.entry_id, e.match_date, (count(*) * 3)::int,
  jsonb_object_agg(e.player_name, jsonb_build_object('qf', 3))
from tmp_qf_bonus_eligible e
where not exists (
  select 1 from public.scores s where s.entry_id = e.entry_id and s.match_date = e.match_date)
group by e.entry_id, e.match_date;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

-- Verification.
select
  (select count(*) from tmp_qf_qualified_nations) as qualified_nations,
  (select count(*) from tmp_qf_bonus_eligible) as eligible_player_slots,
  coalesce(sum(qf_lines), 0)::int as awarded_player_slots,
  coalesce(sum(qf_points), 0)::int as awarded_points
from (
  select
    count(*) filter (where coalesce((b.value->>'qf')::int, 0) = 3) as qf_lines,
    sum(coalesce((b.value->>'qf')::int, 0)) as qf_points
  from public.scores s
  cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as b(key, value)
  where s.match_date between '2026-07-04' and '2026-07-07'
) v;
