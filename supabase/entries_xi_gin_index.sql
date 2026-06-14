-- entries.xi_json sequential scans were timing out the score-day RPC
-- (statement_timeout 57014). With ~70k entries × ~14 jsonb elements per
-- entry, a "where exists (jsonb_array_elements ...)" predicate had to
-- parse ~1M JSON values per query, which exceeds the Postgres timeout
-- and silently dropped scoring for big-fixture days.
--
-- Fix: GIN(jsonb_path_ops) indexes on both xi_json and xi_json_gw1,
-- plus an RPC that uses the @> containment operator (which the index
-- can serve) instead of the unindexable jsonb_array_elements scan.

create index concurrently if not exists entries_xi_json_gin
  on public.entries using gin (xi_json jsonb_path_ops);

create index concurrently if not exists entries_xi_json_gw1_gin
  on public.entries using gin (xi_json_gw1 jsonb_path_ops);

-- Rewrite the RPC to use indexed containment instead of jsonb_array_elements
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
    select 1
    from unnest(p_nations) n
    where e.xi_json @> jsonb_build_array(jsonb_build_object('nation', n))
       or coalesce(e.xi_json_gw1, '[]'::jsonb)
            @> jsonb_build_array(jsonb_build_object('nation', n))
  );
$$;

revoke all on function public.entries_for_nations(text[])
  from public, anon, authenticated;
