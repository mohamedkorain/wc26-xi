-- One-off production cleanup:
-- June 23/24 MVP corrections after the catch-up scoring run.
--
-- Intended MVPs from production ruling:
--   Jordan-Algeria          -> MAZA Ibrahim
--   Norway-Senegal          -> HAALAND Erling
--   England-Ghana           -> BELLINGHAM Jude
--   Panama-Croatia          -> MARTINEZ Cristian
--   Portugal-Uzbekistan     -> CRISTIANO RONALDO
--   Colombia-Congo DR       -> MUNOZ Daniel
--
-- Important:
--   These fixtures all score from the locked MD2 squad (`xi_json_gw2`)
--   because they kicked off before the MD3 deadline.
--
-- Idempotent:
--   - removes stale MVP flags from the previous/incorrect winners
--   - awards the correct MVP to eligible MD2 non-wildcard starters
--   - inserts a score row when MVP is the player's only point on that date
--   - refreshes player leaderboard + entry leaderboard/ranks

set statement_timeout = '5min';

drop table if exists pg_temp.mvp_corrections;
create temp table mvp_corrections (
  match_date date not null,
  correct_player text not null,
  stale_players text[] not null default '{}'::text[]
) on commit drop;

insert into pg_temp.mvp_corrections (match_date, correct_player, stale_players) values
  ('2026-06-23', 'MAZA Ibrahim',      '{}'::text[]),
  ('2026-06-23', 'HAALAND Erling',    '{}'::text[]),
  ('2026-06-23', 'BELLINGHAM Jude',   array['GUEHI Marc', 'RICE Declan']),
  ('2026-06-23', 'MARTINEZ Cristian', array['STANISIC Josip', 'SUTALO Josip']),
  ('2026-06-23', 'CRISTIANO RONALDO', array['NUNO MENDES']),
  ('2026-06-24', 'MUNOZ Daniel',      '{}'::text[]);

-- Remove stale MVPs from wrong June 23 rulings.
with stale as (
  select
    s.entry_id,
    s.match_date,
    old_player
  from public.scores s
  join pg_temp.mvp_corrections c on c.match_date = s.match_date
  cross join lateral unnest(c.stale_players) as old_player
  where coalesce((s.breakdown->old_player->>'mvp')::int, 0) = 1
),
stale_grouped as (
  select
    entry_id,
    match_date,
    array_agg(old_player) as old_players,
    count(*)::int as stale_count
  from stale
  group by entry_id, match_date
),
rebuilt as (
  select
    s.entry_id,
    s.match_date,
    g.stale_count,
    (
      select jsonb_object_agg(
        parts.key,
        case
          when parts.key = any(g.old_players) then parts.value - 'mvp'
          else parts.value
        end
      )
      from jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as parts(key, value)
    ) as new_breakdown
  from public.scores s
  join stale_grouped g
    on g.entry_id = s.entry_id
   and g.match_date = s.match_date
)
update public.scores s
set
  breakdown = rebuilt.new_breakdown,
  points = s.points - rebuilt.stale_count
from rebuilt
where s.entry_id = rebuilt.entry_id
  and s.match_date = rebuilt.match_date;

drop table if exists pg_temp.correct_mvp_entries;
create temp table correct_mvp_entries on commit drop as
select distinct
  c.match_date,
  c.correct_player,
  e.id as entry_id
from pg_temp.mvp_corrections c
join public.entries e
  on e.league_id = '11111111-1111-1111-1111-111111111111'
 and e.submitted_at <= '2026-06-18T16:00:00Z'::timestamptz
cross join lateral jsonb_array_elements(coalesce(e.xi_json_gw2, '[]'::jsonb)) as slot
where slot->>'name' = c.correct_player
  and coalesce((slot->>'wild')::boolean, false) = false;

-- Add the correct MVP to existing score rows.
with target as (
  select
    s.entry_id,
    s.match_date,
    c.correct_player,
    coalesce((s.breakdown->c.correct_player->>'mvp')::int, 0) as old_mvp
  from public.scores s
  join pg_temp.correct_mvp_entries c
    on c.entry_id = s.entry_id
   and c.match_date = s.match_date
),
patched as (
  select
    t.entry_id,
    t.match_date,
    t.correct_player,
    t.old_mvp
  from target t
  where t.old_mvp <> 1
)
update public.scores s
set
  breakdown = jsonb_set(
    coalesce(s.breakdown, '{}'::jsonb),
    array[patched.correct_player],
    coalesce(s.breakdown->patched.correct_player, '{}'::jsonb) || '{"mvp":1}'::jsonb,
    true
  ),
  points = s.points + 1
from patched
where s.entry_id = patched.entry_id
  and s.match_date = patched.match_date;

-- Insert score rows where MVP is the only point this entry has on that date.
insert into public.scores (entry_id, match_date, points, breakdown)
select
  c.entry_id,
  c.match_date,
  1,
  jsonb_build_object(c.correct_player, jsonb_build_object('mvp', 1))
from pg_temp.correct_mvp_entries c
where not exists (
  select 1
  from public.scores s
  where s.entry_id = c.entry_id
    and s.match_date = c.match_date
);

insert into public.scoring_progress (match_date, offset_, updated_at)
values
  ('2026-06-23', 0, now()),
  ('2026-06-24', 0, now())
on conflict (match_date)
do update set offset_ = 0, updated_at = excluded.updated_at;

select public.refresh_player_leaderboard();
select public.refresh_leaderboard_and_ranks();

select
  s.match_date,
  p.player_name,
  pp.nation,
  count(*) as owner_rows
from public.scores s
cross join lateral jsonb_each(coalesce(s.breakdown, '{}'::jsonb)) as p(player_name, stats)
left join public.player_pool pp on pp.name = p.player_name
where s.match_date in ('2026-06-23', '2026-06-24')
  and coalesce((p.stats->>'mvp')::int, 0) = 1
group by s.match_date, p.player_name, pp.nation
order by s.match_date, owner_rows desc;
