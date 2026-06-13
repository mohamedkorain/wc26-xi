-- Rank movement arrows on the leaderboard.
-- After each score-day run, we snapshot the previous rank and recompute the
-- current rank. UI compares them to render ↑ / ↓ / − badges.

alter table public.entries
  add column if not exists rank_current int,
  add column if not exists rank_previous int;

create or replace function public.refresh_entry_ranks()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with ranked as (
    select
      entry_id,
      row_number() over (order by total_points desc, submitted_at asc) as new_rank
    from public.leaderboard_totals
    where league_id = '11111111-1111-1111-1111-111111111111'
  )
  update public.entries e
  set
    rank_previous = e.rank_current,   -- yesterday's "current" becomes "previous"
    rank_current  = ranked.new_rank   -- today's fresh rank
  from ranked
  where e.id = ranked.entry_id;
end;
$$;

revoke all on function public.refresh_entry_ranks() from public, anon, authenticated;

-- Seed: populate rank_current for the first time. rank_previous stays NULL
-- so the UI shows a NEW badge on first arrival.
select public.refresh_entry_ranks();
