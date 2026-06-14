-- Scaling fix for 73k+ entries: stop scanning JSONB on every scoring run.
-- Maintain a flat (entry_id, nation) lookup that's btree-indexable.
--
-- After this migration, entries_for_nations becomes a simple
-- "WHERE nation IN (...)" — sub-second regardless of entry count.

-- 1) The lookup table
create table if not exists public.entry_nations (
  entry_id uuid not null references public.entries(id) on delete cascade,
  nation   text not null,
  primary key (entry_id, nation)
);

create index if not exists entry_nations_nation_idx on public.entry_nations(nation);

alter table public.entry_nations enable row level security;
-- No policies → only service_role (which bypasses RLS) can read/write.

-- 2) Trigger function: rebuild this entry's nations from xi_json + xi_json_gw1
create or replace function public.entry_nations_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  delete from public.entry_nations where entry_id = NEW.id;
  insert into public.entry_nations(entry_id, nation)
  select NEW.id, distinct_nation
  from (
    select distinct (p->>'nation') as distinct_nation
    from jsonb_array_elements(
      coalesce(NEW.xi_json, '[]'::jsonb)
      || coalesce(NEW.xi_json_gw1, '[]'::jsonb)
    ) p
    where (p->>'nation') is not null
  ) sub
  on conflict do nothing;
  return NEW;
end
$fn$;

drop trigger if exists entries_xi_sync_trg on public.entries;
create trigger entries_xi_sync_trg
  after insert or update of xi_json, xi_json_gw1 on public.entries
  for each row execute function public.entry_nations_sync();

-- 3) One-shot backfill for existing 73k rows
truncate public.entry_nations;
insert into public.entry_nations(entry_id, nation)
select e.id, distinct_nation
from public.entries e
cross join lateral (
  select distinct (p->>'nation') as distinct_nation
  from jsonb_array_elements(
    coalesce(e.xi_json, '[]'::jsonb)
    || coalesce(e.xi_json_gw1, '[]'::jsonb)
  ) p
  where (p->>'nation') is not null
) sub
on conflict do nothing;

-- 4) Rewrite the RPC: simple indexed lookup
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

-- Sanity check the migration worked
select 'entry_nations rows' as label, count(*) as n from public.entry_nations
union all select 'entries rows', count(*) from public.entries;
