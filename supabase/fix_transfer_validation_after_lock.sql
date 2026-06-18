-- Fix post-lock transfer validation.
--
-- Why:
--   Transfer updates send the old XI into xi_json_gw1 and the new XI into
--   xi_json. The generic lineup validator was re-validating both after lock,
--   so legacy saved rows with harmless player-metadata drift could block the
--   bundled two-transfer flow with:
--
--     Squad contains invalid player, role, or slot data
--
-- This keeps initial submissions strict, and lets the post-lock transfer
-- guard enforce transfer-specific safety.

set statement_timeout = '5min';

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
  select l.locked_at
    into v_locked_at
  from public.leagues l
  where l.id = NEW.league_id;

  -- Initial submissions and pre-lock edits should be fully canonical. After
  -- lock, transfer updates are checked by guard_locked_entry_transfer_trg so
  -- legacy saved rows are not blocked by later player-metadata drift.
  if TG_OP = 'INSERT' or now() < v_locked_at then
    perform public.validate_entry_xi_json(NEW.xi_json);

    if NEW.xi_json_gw1 is not null then
      perform public.validate_entry_xi_json(NEW.xi_json_gw1);
    end if;
  end if;

  if TG_OP = 'INSERT' then
    v_request_role := coalesce(current_setting('request.jwt.claim.role', true), '');

    if now() >= v_locked_at and v_request_role in ('authenticated', 'anon') then
      raise exception 'Entry submission is locked';
    end if;
  end if;

  return NEW;
end;
$$;

create or replace function public.guard_locked_entry_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_at timestamptz;
  v_transfers_open_until timestamptz;
  v_changed_slots int;
  v_total_slots int;
  v_valid_slots int;
  v_distinct_players int;
  v_arab_count int;
  v_max_nation_count int;
begin
  select l.locked_at, l.transfers_open_until
    into v_locked_at, v_transfers_open_until
  from public.leagues l
  where l.id = NEW.league_id;

  if now() < v_locked_at then
    return NEW;
  end if;

  if v_transfers_open_until is null or now() >= v_transfers_open_until then
    raise exception 'Entry updates are locked';
  end if;

  if NEW.xi_json is not distinct from OLD.xi_json
     and NEW.xi_json_gw1 is not distinct from OLD.xi_json_gw1
     and NEW.transfers_used is not distinct from OLD.transfers_used
     and NEW.team_name is not distinct from OLD.team_name
     and NEW.formation is not distinct from OLD.formation then
    if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated' then
      raise exception 'Only transfer updates are allowed after lock';
    end if;
    return NEW;
  end if;

  if NEW.user_id is distinct from OLD.user_id
     or NEW.league_id is distinct from OLD.league_id
     or NEW.submitted_at is distinct from OLD.submitted_at
     or NEW.team_name is distinct from OLD.team_name
     or NEW.formation is distinct from OLD.formation
     or NEW.rank_current is distinct from OLD.rank_current
     or NEW.rank_previous is distinct from OLD.rank_previous then
    raise exception 'Only transfer updates are allowed after lock';
  end if;

  if NEW.transfers_used is distinct from OLD.transfers_used + 2
     or NEW.transfers_used > 2 then
    raise exception 'Transfer update must use exactly two transfers';
  end if;

  v_total_slots := jsonb_array_length(coalesce(NEW.xi_json, '[]'::jsonb));
  if v_total_slots <> 12 then
    raise exception 'Squad must contain exactly 12 players';
  end if;

  select count(*) into v_valid_slots
  from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as o(player, ord)
  full join jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
    using (ord)
  join public.player_pool pp
    on pp.nation = x.player->>'nation'
   and pp.name = x.player->>'name'
  where jsonb_typeof(x.player) = 'object'
    and (x.player->>'slot') ~ '^[0-9]+$'
    and (x.player->>'slot')::int = (x.ord - 1)
    and (
      -- Unchanged legacy rows must be byte-for-byte unchanged, but do not
      -- need to match today's player_pool display metadata.
      (o.player is not null and x.player = o.player)
      or
      -- The two incoming transfer rows must be canonical and valid for slot.
      (
        ((o.player->>'name') is distinct from (x.player->>'name')
          or (o.player->>'nation') is distinct from (x.player->>'nation'))
        and coalesce(x.player->>'nation_code', '') = pp.nation_code
        and (x.player->>'category') ~ '^[0-9]+$'
        and (x.player->>'category')::int = pp.category
        and coalesce((x.player->>'arab')::boolean, false) = pp.arab
        and (x.player->>'no') ~ '^[0-9]+$'
        and (x.player->>'no')::int = pp.no
        and coalesce(x.player->>'shirt_name', '') = coalesce(pp.shirt_name, '')
        and coalesce(x.player->>'club', '') = coalesce(pp.club, '')
        and (
          (
            (x.ord - 1) = 11
            and coalesce((x.player->>'wild')::boolean, false)
            and nullif(x.player->>'role', '') is null
          )
          or
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
        )
      )
    );

  if v_valid_slots <> 12 then
    raise exception 'Squad contains invalid player data';
  end if;

  select count(distinct (x.player->>'nation') || chr(31) || (x.player->>'name'))
    into v_distinct_players
  from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) as x(player);

  if v_distinct_players <> 12 then
    raise exception 'Squad cannot contain duplicate players';
  end if;

  select count(*) into v_arab_count
  from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) as x(player)
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
    from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) as x(player)
    group by x.player->>'nation'
  ) counts;

  if v_max_nation_count > 3 then
    raise exception 'Squad cannot contain more than three players from one nation';
  end if;

  if OLD.xi_json_gw1 is null then
    if NEW.xi_json_gw1 is distinct from OLD.xi_json then
      raise exception 'First transfer update must snapshot the original squad';
    end if;
  elsif NEW.xi_json_gw1 is distinct from OLD.xi_json_gw1 then
    raise exception 'Original squad snapshot cannot change';
  end if;

  select count(*) into v_changed_slots
  from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as o(player, ord)
  full join jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as n(player, ord)
    using (ord)
  where (o.player->>'name') is distinct from (n.player->>'name')
     or (o.player->>'nation') is distinct from (n.player->>'nation');

  if v_changed_slots <> 2 then
    raise exception 'Transfer update must change exactly two squad slots';
  end if;

  return NEW;
end;
$$;

select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.entries'::regclass
  and tgname in ('guard_locked_entry_transfer_trg', 'validate_entry_lineup_write_trg')
order by tgname;
