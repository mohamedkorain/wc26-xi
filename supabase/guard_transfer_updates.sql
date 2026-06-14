-- Guard locked-squad updates during transfer windows.
--
-- RLS allows users to UPDATE their own entry while a transfer window is open.
-- This trigger narrows what that UPDATE may do after the initial lock:
--   - no team/user/league/submission metadata edits
--   - exactly two lineup slots changed
--   - transfers_used advances by exactly 2, capped at 2 for this window
--   - xi_json_gw1 preserves the pre-transfer lineup
--
-- This blocks build.html/upsert or crafted requests from replacing a full
-- locked squad while preserving the bundled two-transfer flow in team.js.

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

  -- Pre-lock edits are the original draft flow.
  if now() < v_locked_at then
    return NEW;
  end if;

  if v_transfers_open_until is null or now() >= v_transfers_open_until then
    raise exception 'Entry updates are locked';
  end if;

  -- Server-maintained fields such as rank_current/rank_previous may still
  -- update after lock. Only validate when the squad or transfer counter moves.
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

  -- Validate every post-transfer row against the official player pool, not
  -- just the two changed slots. This prevents crafted JSON from inventing
  -- players, changing metadata, or putting a player into an invalid role.
  select count(*) into v_valid_slots
  from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
  join public.player_pool pp
    on pp.nation = x.player->>'nation'
   and pp.name = x.player->>'name'
  where (x.player->>'slot')::int = (x.ord - 1)
    and coalesce(x.player->>'nation_code', '') = pp.nation_code
    and (x.player->>'category')::int = pp.category
    and (x.player->>'arab')::boolean = pp.arab
    and (x.player->>'no')::int = pp.no
    and coalesce(x.player->>'shirt_name', '') = coalesce(pp.shirt_name, '')
    and coalesce(x.player->>'club', '') = coalesce(pp.club, '')
    and (
      coalesce((x.player->>'wild')::boolean, false)
      or pp.roles @> array[x.player->>'role']
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

drop trigger if exists guard_locked_entry_transfer_trg on public.entries;
create trigger guard_locked_entry_transfer_trg
  before update on public.entries
  for each row execute function public.guard_locked_entry_transfer();
