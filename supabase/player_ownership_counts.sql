-- Cached current-squad player ownership.
--
-- Why: calculating ownership directly from entries.xi_json on every homepage
-- load would scan ~75k entries x 12 JSON slots. This table is kept current by
-- an entries trigger, so the public UI reads a small count table instead.
--
-- Definition: ownership = player appears in the entry's current xi_json,
-- including the wildcard slot. This reflects post-transfer squads.

create table if not exists public.player_ownership_counts (
  league_id   uuid not null references public.leagues(id) on delete cascade,
  player_name text not null,
  nation      text not null,
  owners      int not null default 0 check (owners >= 0),
  primary key (league_id, player_name, nation)
);

alter table public.player_ownership_counts enable row level security;

drop policy if exists "player ownership read all" on public.player_ownership_counts;
create policy "player ownership read all"
  on public.player_ownership_counts
  for select using (true);

grant select on public.player_ownership_counts to anon, authenticated;

create or replace function public.player_ownership_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP in ('UPDATE', 'DELETE') then
    with old_players as (
      select distinct
        OLD.league_id as league_id,
        p->>'name' as player_name,
        p->>'nation' as nation
      from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) p
      where p->>'name' is not null
        and p->>'nation' is not null
    )
    update public.player_ownership_counts poc
       set owners = greatest(0, poc.owners - 1)
      from old_players op
     where poc.league_id = op.league_id
       and poc.player_name = op.player_name
       and poc.nation = op.nation;
  end if;

  if TG_OP in ('INSERT', 'UPDATE') then
    with new_players as (
      select distinct
        NEW.league_id as league_id,
        p->>'name' as player_name,
        p->>'nation' as nation
      from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) p
      where p->>'name' is not null
        and p->>'nation' is not null
    )
    insert into public.player_ownership_counts (league_id, player_name, nation, owners)
    select league_id, player_name, nation, 1
    from new_players
    on conflict (league_id, player_name, nation)
    do update set owners = public.player_ownership_counts.owners + 1;
  end if;

  delete from public.player_ownership_counts where owners <= 0;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

drop trigger if exists entries_player_ownership_sync_trg on public.entries;
create trigger entries_player_ownership_sync_trg
  after insert or update of xi_json or delete on public.entries
  for each row execute function public.player_ownership_sync();

-- One-shot backfill for existing entries.
truncate public.player_ownership_counts;
insert into public.player_ownership_counts (league_id, player_name, nation, owners)
select
  e.league_id,
  p->>'name' as player_name,
  p->>'nation' as nation,
  count(distinct e.id)::int as owners
from public.entries e
cross join lateral jsonb_array_elements(coalesce(e.xi_json, '[]'::jsonb)) p
where p->>'name' is not null
  and p->>'nation' is not null
group by e.league_id, p->>'name', p->>'nation';

select
  count(*) as player_rows,
  coalesce(sum(owners), 0) as total_owned_slots
from public.player_ownership_counts
where league_id = '11111111-1111-1111-1111-111111111111';
