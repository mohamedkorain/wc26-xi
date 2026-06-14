-- Static SQL with EXISTS+UNNEST doesn't let the planner use the
-- jsonb_path_ops GIN index for each containment check. Single @>
-- queries ARE fast (sub-second), but the wrapped predicate forced
-- a sequential scan and hit statement_timeout 57014.
--
-- Switch to plpgsql + EXECUTE so we generate an explicit OR list of
-- @> containment clauses — each one is independently index-eligible.

create or replace function public.entries_for_nations(p_nations text[])
returns setof public.entries
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  q text;
  ors text := '';
  n text;
  needle jsonb;
begin
  if p_nations is null or array_length(p_nations, 1) is null then
    return;
  end if;

  foreach n in array p_nations loop
    needle := jsonb_build_array(jsonb_build_object('nation', n));
    if ors <> '' then ors := ors || ' or '; end if;
    ors := ors
      || 'xi_json @> ' || quote_literal(needle::text) || '::jsonb'
      || ' or coalesce(xi_json_gw1, ''[]''::jsonb) @> '
      || quote_literal(needle::text) || '::jsonb';
  end loop;

  q := 'select distinct e.* from public.entries e where ' || ors;
  return query execute q;
end
$fn$;

revoke all on function public.entries_for_nations(text[])
  from public, anon, authenticated;
