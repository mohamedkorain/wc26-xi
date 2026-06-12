-- Per-gameweek squad snapshots so transfers in the GW2 window only affect
-- GW2+ scoring (and the homepage keeps showing the GW1 lineup that's
-- currently being scored).

alter table public.entries
  add column if not exists xi_json_gw1 jsonb;

-- Sanity check
select id, (xi_json_gw1 is not null) as has_gw1_snapshot
from public.entries
where transfers_used > 0
limit 5;
