-- refresh_entry_ranks was timing out (57014) at 73k entries because
-- it updated every row every time, even no-change rows. With ~73k
-- entries the UPDATE itself was the bottleneck (WAL churn).
--
-- Fix:
--   1) Only UPDATE rows whose rank actually changed (typically <10%
--      of entries per refresh).
--   2) Bump local statement_timeout to 5min for this function only,
--      so the big-day windowing/aggregation has room.

create or replace function public.refresh_entry_ranks()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  set local statement_timeout = '300s';

  with ranked as (
    select
      entry_id,
      row_number() over (order by total_points desc, submitted_at asc) as new_rank
    from public.leaderboard_totals
    where league_id = '11111111-1111-1111-1111-111111111111'
  )
  update public.entries e
  set
    rank_previous = e.rank_current,
    rank_current  = ranked.new_rank
  from ranked
  where e.id = ranked.entry_id
    and e.rank_current is distinct from ranked.new_rank;
end;
$$;

revoke all on function public.refresh_entry_ranks()
  from public, anon, authenticated;

-- Run it now to seed correct ranks
select public.refresh_entry_ranks();
