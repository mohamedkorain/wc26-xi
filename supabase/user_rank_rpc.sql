-- Returns the 1-based rank of a user's entry within a league's leaderboard.
-- Sort matches the client: total_points desc, then submitted_at asc.
create or replace function public.user_rank(p_league_id uuid, p_user_id uuid)
returns int language sql stable security invoker as $$
  with ranked as (
    select user_id,
           row_number() over (order by total_points desc, submitted_at asc) as rnk
    from public.leaderboard_totals
    where league_id = p_league_id
  )
  select rnk::int from ranked where user_id = p_user_id;
$$;

grant execute on function public.user_rank(uuid, uuid) to anon, authenticated;
