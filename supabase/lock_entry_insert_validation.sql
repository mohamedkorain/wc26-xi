-- Close crafted-entry insert exploit.
--
-- Root cause:
--   During the transfer window, RLS allowed authenticated users to INSERT an
--   entry. The strict guard existed only for UPDATE, so a crafted REST request
--   could insert arbitrary xi_json (duplicate players, all-one-nation squads,
--   malformed slots). The frontend never allowed this, but DB insert validation
--   must be authoritative.
--
-- Run this in Supabase SQL Editor as one block.

set statement_timeout = '5min';

-- Remove known crafted entries. Their scores cascade from entries.
delete from public.entries
where id in (
  'b66b30d4-002a-4237-8331-81fdd0b35254',
  '3a3aa5fb-53b2-49f5-947b-5d31584becb2',
  '08e7061a-3792-4aa1-901f-8af7cae4006a',
  '29df2537-fd8c-4fb6-a4d1-7bbee24048fd',
  '634dfde1-468f-45c7-b694-47b548244c70',
  '9fb81cfd-15fd-48f9-88a4-90a54d00a8e5',
  'fb692e38-2181-40ed-a192-afe07ac758c8',
  '2990d213-07e3-4423-9380-7779ab73eed4',
  '9fc521b2-ea3f-4c11-87cb-01048fb1510b'
);

-- Transfer flow uses UPDATE, not INSERT. New entries after lock must stay
-- closed even while transfers are open.
drop policy if exists "entries insert self open" on public.entries;
create policy "entries insert self open" on public.entries
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.leagues l
      where l.id = league_id
        and now() < l.locked_at
    )
  );

create or replace function public.validate_entry_xi_json(p_xi jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_slots int;
  v_valid_slots int;
  v_distinct_players int;
  v_arab_count int;
  v_wild_count int;
  v_max_nation_count int;
begin
  if p_xi is null or jsonb_typeof(p_xi) <> 'array' then
    raise exception 'Squad must be a JSON array';
  end if;

  v_total_slots := jsonb_array_length(p_xi);
  if v_total_slots <> 12 then
    raise exception 'Squad must contain exactly 12 players';
  end if;

  select count(*) into v_wild_count
  from jsonb_array_elements(p_xi) as x(player)
  where coalesce((x.player->>'wild')::boolean, false);

  if v_wild_count <> 1 then
    raise exception 'Squad must contain exactly one wildcard';
  end if;

  -- Validate official player metadata, slot order, wildcard placement, and
  -- the role required by each slot. This blocks duplicated stars in multiple
  -- slots and blocks malformed all-one-team payloads before scoring sees them.
  select count(*) into v_valid_slots
  from jsonb_array_elements(p_xi) with ordinality as x(player, ord)
  join public.player_pool pp
    on pp.nation = x.player->>'nation'
   and pp.name = x.player->>'name'
  where jsonb_typeof(x.player) = 'object'
    and (x.player->>'slot') ~ '^[0-9]+$'
    and (x.player->>'slot')::int = (x.ord - 1)
    and coalesce(x.player->>'nation_code', '') = pp.nation_code
    and (x.player->>'category') ~ '^[0-9]+$'
    and (x.player->>'category')::int = pp.category
    and coalesce((x.player->>'arab')::boolean, false) = pp.arab
    and (x.player->>'no') ~ '^[0-9]+$'
    and (x.player->>'no')::int = pp.no
    and coalesce(x.player->>'shirt_name', '') = coalesce(pp.shirt_name, '')
    and coalesce(x.player->>'club', '') = coalesce(pp.club, '')
    and (
      -- Slot 11 is the wildcard: it must be wild and must not score as a
      -- starter role.
      (
        (x.ord - 1) = 11
        and coalesce((x.player->>'wild')::boolean, false)
        and nullif(x.player->>'role', '') is null
      )
      or
      -- Slots 0-10 are starters and must match the formation role layout.
      (
        (x.ord - 1) <> 11
        and not coalesce((x.player->>'wild')::boolean, false)
        and x.player->>'role' = case
          when (x.ord - 1) = 0 then 'GK'
          when (x.ord - 1) in (1, 2) then 'CB'
          when (x.ord - 1) in (3, 4) then 'FB'
          when (x.ord - 1) in (5, 6) then 'CM'
          when (x.ord - 1) in (7, 8) then 'WIN'
          when (x.ord - 1) in (9, 10) then 'ST'
        end
        and pp.roles @> array[x.player->>'role']
      )
    );

  if v_valid_slots <> 12 then
    raise exception 'Squad contains invalid player, role, or slot data';
  end if;

  select count(distinct (x.player->>'nation') || chr(31) || (x.player->>'name'))
    into v_distinct_players
  from jsonb_array_elements(p_xi) as x(player);

  if v_distinct_players <> 12 then
    raise exception 'Squad cannot contain duplicate players';
  end if;

  select count(*) into v_arab_count
  from jsonb_array_elements(p_xi) as x(player)
  join public.player_pool pp
    on pp.nation = x.player->>'nation'
   and pp.name = x.player->>'name'
  where pp.arab;

  if v_arab_count < 1 then
    raise exception 'Squad must keep at least one Arab player';
  end if;

  select coalesce(max(n), 0) into v_max_nation_count
  from (
    select x.player->>'nation' as nation, count(*) as n
    from jsonb_array_elements(p_xi) as x(player)
    group by x.player->>'nation'
  ) counts;

  if v_max_nation_count > 3 then
    raise exception 'Squad cannot contain more than three players from one nation';
  end if;
end;
$$;

revoke all on function public.validate_entry_xi_json(jsonb)
  from public, anon, authenticated;

create or replace function public.validate_entry_lineup_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_at timestamptz;
  v_request_role text;
begin
  perform public.validate_entry_xi_json(NEW.xi_json);

  if NEW.xi_json_gw1 is not null then
    perform public.validate_entry_xi_json(NEW.xi_json_gw1);
  end if;

  if TG_OP = 'INSERT' then
    select l.locked_at
      into v_locked_at
    from public.leagues l
    where l.id = NEW.league_id;

    v_request_role := coalesce(current_setting('request.jwt.claim.role', true), '');

    if now() >= v_locked_at and v_request_role in ('authenticated', 'anon') then
      raise exception 'Entry submission is locked';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists validate_entry_lineup_write_trg on public.entries;
create trigger validate_entry_lineup_write_trg
  before insert or update of xi_json, xi_json_gw1 on public.entries
  for each row execute function public.validate_entry_lineup_write();

-- Refresh public cache after deleting the crafted entries.
refresh materialized view concurrently public.leaderboard_totals;
select public.refresh_entry_ranks();

-- Verify the crafted entries are gone from base tables and cached leaderboard.
select 'entries' as source, count(*) as remaining
from public.entries
where id in (
  'b66b30d4-002a-4237-8331-81fdd0b35254',
  '3a3aa5fb-53b2-49f5-947b-5d31584becb2',
  '08e7061a-3792-4aa1-901f-8af7cae4006a',
  '29df2537-fd8c-4fb6-a4d1-7bbee24048fd',
  '634dfde1-468f-45c7-b694-47b548244c70',
  '9fb81cfd-15fd-48f9-88a4-90a54d00a8e5',
  'fb692e38-2181-40ed-a192-afe07ac758c8',
  '2990d213-07e3-4423-9380-7779ab73eed4',
  '9fc521b2-ea3f-4c11-87cb-01048fb1510b'
)
union all
select 'scores' as source, count(*) as remaining
from public.scores
where entry_id in (
  'b66b30d4-002a-4237-8331-81fdd0b35254',
  '3a3aa5fb-53b2-49f5-947b-5d31584becb2',
  '08e7061a-3792-4aa1-901f-8af7cae4006a',
  '29df2537-fd8c-4fb6-a4d1-7bbee24048fd',
  '634dfde1-468f-45c7-b694-47b548244c70',
  '9fb81cfd-15fd-48f9-88a4-90a54d00a8e5',
  'fb692e38-2181-40ed-a192-afe07ac758c8',
  '2990d213-07e3-4423-9380-7779ab73eed4',
  '9fc521b2-ea3f-4c11-87cb-01048fb1510b'
)
union all
select 'leaderboard_totals' as source, count(*) as remaining
from public.leaderboard_totals
where entry_id in (
  'b66b30d4-002a-4237-8331-81fdd0b35254',
  '3a3aa5fb-53b2-49f5-947b-5d31584becb2',
  '08e7061a-3792-4aa1-901f-8af7cae4006a',
  '29df2537-fd8c-4fb6-a4d1-7bbee24048fd',
  '634dfde1-468f-45c7-b694-47b548244c70',
  '9fb81cfd-15fd-48f9-88a4-90a54d00a8e5',
  'fb692e38-2181-40ed-a192-afe07ac758c8',
  '2990d213-07e3-4423-9380-7779ab73eed4',
  '9fc521b2-ea3f-4c11-87cb-01048fb1510b'
);

select jobname, schedule, command
from cron.job
where jobname in (
  'hallo-amrika-score-today',
  'hallo-amrika-score-yesterday',
  'hallo-amrika-refresh-leaderboard'
)
order by jobname;
