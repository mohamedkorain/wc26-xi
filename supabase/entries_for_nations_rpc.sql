-- Replace the score-day Edge Function's huge OR-of-JSONB-cs filter with a
-- single RPC. PostgREST 400s on >~6 OR clauses (URL length / parser
-- limit), causing the function to silently process zero entries and
-- stamp scored_at as if it had finished. RPC sidesteps the URL issue.

create or replace function public.entries_for_nations(p_nations text[])
returns setof public.entries
language sql
security definer
set search_path = public
as $$
  select e.*
  from public.entries e
  where exists (
    select 1
    from jsonb_array_elements(e.xi_json) p
    where (p->>'nation') = any(p_nations)
  )
  or exists (
    select 1
    from jsonb_array_elements(coalesce(e.xi_json_gw1, '[]'::jsonb)) p
    where (p->>'nation') = any(p_nations)
  );
$$;

-- Only service_role should call this (the Edge Function).
revoke all on function public.entries_for_nations(text[]) from public, anon, authenticated;
