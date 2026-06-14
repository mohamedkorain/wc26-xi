-- Live patch only: make score-day pagination deterministic without
-- rebuilding/backfilling entry_nations.

create or replace function public.entries_for_nations(p_nations text[])
returns setof public.entries
language sql
stable
security definer
set search_path = public
as $$
  select e.*
  from public.entries e
  where exists (
    select 1 from public.entry_nations en
    where en.entry_id = e.id
      and en.nation = any(p_nations)
  )
  order by e.id;
$$;

revoke all on function public.entries_for_nations(text[])
  from public, anon, authenticated;
