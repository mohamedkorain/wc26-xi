-- Run once after seed_halo.sql. Adds a server-side aggregated leaderboard view
-- so the client can paginate without pulling every entry's xi_json blob.
--
-- The view sums points per entry (joining scores), then the client can
-- order + limit + range on it. Crucially this means the wire payload per
-- leaderboard page is tiny (~80 bytes/row vs ~5KB with xi_json).

create or replace view public.leaderboard_totals as
select
  e.id                              as entry_id,
  e.league_id,
  e.team_name,
  e.formation,
  e.user_id,
  e.submitted_at,
  coalesce(sum(s.points), 0)::int   as total_points
from public.entries e
left join public.scores s on s.entry_id = e.id
group by e.id;

-- Views in Postgres 15+ default to SECURITY INVOKER, so RLS on the underlying
-- tables (entries / scores — both have public read policies) governs access.
-- Explicit grants for the API roles:
grant select on public.leaderboard_totals to anon, authenticated;

-- Total-count helper for "X of Y entries" display
create or replace function public.entry_count(p_league_id uuid)
returns int language sql stable security invoker as $$
  select count(*)::int from public.entries where league_id = p_league_id;
$$;

grant execute on function public.entry_count(uuid) to anon, authenticated;
