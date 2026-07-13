-- Open the Semi-Final transfer window safely.
--
-- SF rule (identical mechanic to QF):
--   - The R16 scoring squad is already frozen in xi_json_r16 (done separately
--     on 2026-07-09 this script freezes it).
--   - Reset transfers_used to 0 for the QF window.
--   - Users make exactly 3 OUT / 1 IN.
--   - The 1 IN player must be placed in one of the removed starter slots and
--     match that slot's role.
--   - The other 2 removed starter slots become explicit empty slots (score 0).
--   - Empties STACK on top of any empty slots left from the R16 window:
--       new empty starters = old empty starters + 2
--     (sat-out R16 -> 9 real + 2 empty; used R16 -> 7 real + 4 empty).
--   - No Arab-player minimum for this window.
--   - Max 3 real squad players from the same nation still applies.
--   - The free bench-wildcard-into-empty-slot swap is preserved.
--
-- Rerunning after the league is already open to the QF deadline will not reset
-- transfer counters or overwrite xi_json_r16.

set statement_timeout = '5min';

alter table public.entries
  add column if not exists xi_json_r16 jsonb;

alter table public.entries
  add column if not exists xi_json_qf jsonb;

-- Slot -> role helper is created by the R16 window script; recreate defensively.
create or replace function public.entry_slot_role(p_slot int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_slot = 0 then 'GK'
    when p_slot in (1, 2) then 'CB'
    when p_slot in (3, 4) then 'FB'
    when p_slot in (5, 6) then 'CM'
    when p_slot in (7, 8) then 'WIN'
    when p_slot in (9, 10) then 'ST'
    else null
  end
$$;

revoke all on function public.entry_slot_role(int)
from public, anon, authenticated;

do $$
declare
  v_sf_deadline constant timestamptz := '2026-07-14 19:00:00+00';
  v_previous_window timestamptz;
  v_reset_entries int := 0;
begin
  select transfers_open_until
    into v_previous_window
  from public.leagues
  where id = '11111111-1111-1111-1111-111111111111';

  if v_previous_window is distinct from v_sf_deadline then
    if exists (select 1 from pg_trigger
               where tgrelid = 'public.entries'::regclass
                 and tgname = 'guard_locked_entry_transfer_trg') then
      execute 'alter table public.entries disable trigger guard_locked_entry_transfer_trg';
    end if;
    if exists (select 1 from pg_trigger
               where tgrelid = 'public.entries'::regclass
                 and tgname = 'log_entry_transfer_update_trg') then
      execute 'alter table public.entries disable trigger log_entry_transfer_update_trg';
    end if;
    execute 'alter table public.entries disable trigger validate_entry_lineup_write_trg';
    execute 'alter table public.entries disable trigger entries_xi_sync_trg';

    begin
      update public.entries
         set xi_json_qf = coalesce(xi_json_qf, xi_json),
             transfers_used = 0
       where league_id = '11111111-1111-1111-1111-111111111111'
         and (xi_json_qf is null or coalesce(transfers_used, 0) <> 0);
      get diagnostics v_reset_entries = row_count;
    exception when others then
      execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
      execute 'alter table public.entries enable trigger log_entry_transfer_update_trg';
      raise;
    end;

    execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
    execute 'alter table public.entries enable trigger log_entry_transfer_update_trg';
    execute 'alter table public.entries enable trigger validate_entry_lineup_write_trg';
    execute 'alter table public.entries enable trigger entries_xi_sync_trg';
  end if;

  update public.leagues
     set transfers_open_until = v_sf_deadline
   where id = '11111111-1111-1111-1111-111111111111';

  raise notice 'SF transfer window prepared. entries_reset=% previous_window=%',
    v_reset_entries, v_previous_window;
end;
$$;

create or replace function public.validate_entry_lineup_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_at timestamptz;
  v_transfers_open_until timestamptz;
  v_transfer_open boolean;
  v_request_role text;
begin
  select l.locked_at, l.transfers_open_until
    into v_locked_at, v_transfers_open_until
  from public.leagues l
  where l.id = NEW.league_id;

  v_transfer_open := v_transfers_open_until is not null and now() < v_transfers_open_until;
  v_request_role := coalesce(current_setting('request.jwt.claim.role', true), '');

  if TG_OP = 'INSERT' or now() < v_locked_at then
    perform public.validate_entry_xi_json(NEW.xi_json);
    if NEW.xi_json_gw1 is not null then perform public.validate_entry_xi_json(NEW.xi_json_gw1); end if;
    if NEW.xi_json_gw2 is not null then perform public.validate_entry_xi_json(NEW.xi_json_gw2); end if;
    if NEW.xi_json_gw3 is not null then perform public.validate_entry_xi_json(NEW.xi_json_gw3); end if;
    if NEW.xi_json_r32 is not null then perform public.validate_entry_xi_json(NEW.xi_json_r32); end if;
    if NEW.xi_json_r16 is not null then perform public.validate_entry_xi_json(NEW.xi_json_r16); end if;
    if NEW.xi_json_qf is not null then perform public.validate_entry_xi_json(NEW.xi_json_qf); end if;
  end if;

  if TG_OP = 'INSERT' then
    if now() >= v_locked_at
       and not v_transfer_open
       and v_request_role in ('authenticated', 'anon') then
      raise exception 'Entry submission is locked';
    end if;

    if now() >= v_locked_at
       and v_transfer_open
       and v_request_role in ('authenticated', 'anon') then
      if coalesce(NEW.transfers_used, 0) <> 0 then
        raise exception 'Late first submission must start with zero transfers';
      end if;
      if NEW.xi_json_gw1 is not null
         or NEW.xi_json_gw2 is not null
         or NEW.xi_json_gw3 is not null
         or NEW.xi_json_r32 is not null
         or NEW.xi_json_r16 is not null
         or NEW.xi_json_qf is not null then
        raise exception 'Late first submission cannot prefill squad snapshots';
      end if;
      perform public.validate_late_joiner_randomizer_shape(NEW.xi_json);
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists validate_entry_lineup_write_trg on public.entries;
create trigger validate_entry_lineup_write_trg
  before insert or update of xi_json, xi_json_gw1, xi_json_gw2, xi_json_gw3, xi_json_r32, xi_json_r16, xi_json_qf on public.entries
  for each row execute function public.validate_entry_lineup_write();

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
  v_old_empty_slots int;
  v_new_empty_slots int;
  v_emptied_slots int;
  v_refilled_slots int;
  v_real_slots int;
  v_old_real_slots int;
  v_distinct_players int;
  v_max_nation_count int;
  v_is_wildcard_swap boolean := false;
begin
  select l.locked_at, l.transfers_open_until
    into v_locked_at, v_transfers_open_until
  from public.leagues l
  where l.id = NEW.league_id;

  if now() < v_locked_at then
    return NEW;
  end if;

  if NEW.xi_json is not distinct from OLD.xi_json
     and NEW.xi_json_gw1 is not distinct from OLD.xi_json_gw1
     and NEW.xi_json_gw2 is not distinct from OLD.xi_json_gw2
     and NEW.xi_json_gw3 is not distinct from OLD.xi_json_gw3
     and NEW.xi_json_r32 is not distinct from OLD.xi_json_r32
     and NEW.xi_json_r16 is not distinct from OLD.xi_json_r16
     and NEW.xi_json_qf is not distinct from OLD.xi_json_qf
     and NEW.transfers_used is not distinct from OLD.transfers_used
     and NEW.team_name is not distinct from OLD.team_name
     and NEW.formation is not distinct from OLD.formation
     and NEW.user_id is not distinct from OLD.user_id
     and NEW.league_id is not distinct from OLD.league_id
     and NEW.submitted_at is not distinct from OLD.submitted_at then
    if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated' then
      raise exception 'Only transfer updates are allowed after lock';
    end if;
    return NEW;
  end if;

  if v_transfers_open_until is null or now() >= v_transfers_open_until then
    raise exception 'Entry updates are locked';
  end if;

  if NEW.user_id is distinct from OLD.user_id
     or NEW.league_id is distinct from OLD.league_id
     or NEW.submitted_at is distinct from OLD.submitted_at
     or NEW.team_name is distinct from OLD.team_name
     or NEW.formation is distinct from OLD.formation
     or NEW.rank_current is distinct from OLD.rank_current
     or NEW.rank_previous is distinct from OLD.rank_previous
     or (OLD.xi_json_gw1 is not null and NEW.xi_json_gw1 is distinct from OLD.xi_json_gw1)
     or NEW.xi_json_gw2 is distinct from OLD.xi_json_gw2
     or NEW.xi_json_gw3 is distinct from OLD.xi_json_gw3
     or NEW.xi_json_r32 is distinct from OLD.xi_json_r32
     or NEW.xi_json_r16 is distinct from OLD.xi_json_r16
     or NEW.xi_json_qf is distinct from OLD.xi_json_qf then
    raise exception 'Only transfer updates are allowed after lock';
  end if;

  v_total_slots := jsonb_array_length(coalesce(NEW.xi_json, '[]'::jsonb));
  if v_total_slots <> 12 then
    raise exception 'Squad must contain exactly 12 slots';
  end if;

  select count(*) into v_changed_slots
  from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as o(player, ord)
  full join jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as n(player, ord)
    using (ord)
  where (o.player->>'name') is distinct from (n.player->>'name')
     or (o.player->>'nation') is distinct from (n.player->>'nation')
     or coalesce((o.player->>'empty')::boolean, false) is distinct from coalesce((n.player->>'empty')::boolean, false);

  -- Free bench-wildcard swap: move a real bench wildcard onto a same-role
  -- starter slot (normal swap) or into an already-empty same-role starter slot.
  -- Does not consume the SF 3-out/1-in move and cannot alter snapshots.
  with old_rows as (
    select x.ord, x.player from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
  ),
  new_rows as (
    select x.ord, x.player from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
  ),
  changed as (
    select o.ord, o.player as old_player, n.player as new_player
    from old_rows o join new_rows n using (ord)
    where (o.player->>'name') is distinct from (n.player->>'name')
       or (o.player->>'nation') is distinct from (n.player->>'nation')
  ),
  old_wild as (select ord, player from old_rows where coalesce((player->>'wild')::boolean, false)),
  new_wild as (select ord, player from new_rows where coalesce((player->>'wild')::boolean, false))
  select exists (
    select 1
    from changed starter_change
    cross join old_wild ow
    cross join new_wild nw
    join public.player_pool wild_pp
      on wild_pp.nation = ow.player->>'nation' and wild_pp.name = ow.player->>'name'
    where v_changed_slots = 2
      and (select count(*) from old_wild) = 1
      and (select count(*) from new_wild) = 1
      and ow.ord = 12
      and nw.ord = 12
      and (ow.player->>'slot') ~ '^[0-9]+$'
      and (ow.player->>'slot')::int = 11
      and (
        (
          -- Normal wildcard swap: real starter <-> bench wildcard.
          (starter_change.old_player->>'slot') ~ '^[0-9]+$'
          and (starter_change.old_player->>'slot')::int = starter_change.ord - 1
          and not coalesce((starter_change.old_player->>'wild')::boolean, false)
          and not coalesce((starter_change.old_player->>'empty')::boolean, false)
          and not coalesce((starter_change.new_player->>'wild')::boolean, false)
          and not coalesce((starter_change.new_player->>'empty')::boolean, false)
          and starter_change.new_player->>'name' = ow.player->>'name'
          and starter_change.new_player->>'nation' = ow.player->>'nation'
          and (starter_change.new_player->>'slot') ~ '^[0-9]+$'
          and (starter_change.new_player->>'slot')::int = starter_change.ord - 1
          and starter_change.new_player->>'role' = public.entry_slot_role((starter_change.ord - 1)::int)
          and wild_pp.roles @> array[starter_change.new_player->>'role']
          and nw.player->>'name' = starter_change.old_player->>'name'
          and nw.player->>'nation' = starter_change.old_player->>'nation'
          and (nw.player->>'slot') ~ '^[0-9]+$'
          and (nw.player->>'slot')::int = 11
          and not coalesce((nw.player->>'empty')::boolean, false)
          and nullif(nw.player->>'role', '') is null
        )
        or
        (
          -- Wildcard fills an empty same-role starter slot; bench becomes empty.
          (starter_change.ord - 1) between 0 and 10
          and (starter_change.old_player->>'slot') ~ '^[0-9]+$'
          and (starter_change.old_player->>'slot')::int = starter_change.ord - 1
          and coalesce((starter_change.old_player->>'empty')::boolean, false)
          and not coalesce((starter_change.old_player->>'wild')::boolean, false)
          and starter_change.old_player->>'role' = public.entry_slot_role((starter_change.ord - 1)::int)
          and not coalesce((starter_change.new_player->>'wild')::boolean, false)
          and not coalesce((starter_change.new_player->>'empty')::boolean, false)
          and starter_change.new_player->>'name' = ow.player->>'name'
          and starter_change.new_player->>'nation' = ow.player->>'nation'
          and (starter_change.new_player->>'slot') ~ '^[0-9]+$'
          and (starter_change.new_player->>'slot')::int = starter_change.ord - 1
          and starter_change.new_player->>'role' = public.entry_slot_role((starter_change.ord - 1)::int)
          and wild_pp.roles @> array[starter_change.new_player->>'role']
          and coalesce((nw.player->>'wild')::boolean, false)
          and coalesce((nw.player->>'empty')::boolean, false)
          and (nw.player->>'slot') ~ '^[0-9]+$'
          and (nw.player->>'slot')::int = 11
          and nullif(nw.player->>'name', '') is null
          and nullif(nw.player->>'nation', '') is null
          and nullif(nw.player->>'role', '') is null
        )
      )
  )
    into v_is_wildcard_swap;

  if v_is_wildcard_swap then
    if NEW.transfers_used is distinct from OLD.transfers_used then
      raise exception 'Wildcard swap must not change transfer count';
    end if;
    if OLD.xi_json_gw1 is null then
      if NEW.xi_json_gw1 is distinct from OLD.xi_json then
        raise exception 'First post-lock update must snapshot the original squad';
      end if;
    elsif NEW.xi_json_gw1 is distinct from OLD.xi_json_gw1 then
      raise exception 'Original squad snapshot cannot change';
    end if;
    if NEW.xi_json_gw2 is distinct from OLD.xi_json_gw2
       or NEW.xi_json_gw3 is distinct from OLD.xi_json_gw3
       or NEW.xi_json_r32 is distinct from OLD.xi_json_r32
       or NEW.xi_json_r16 is distinct from OLD.xi_json_r16
     or NEW.xi_json_qf is distinct from OLD.xi_json_qf then
      raise exception 'Squad snapshots cannot change';
    end if;
    return NEW;
  end if;

  -- QF main move: exactly one incoming player (3 out, 1 in).
  if NEW.transfers_used is distinct from OLD.transfers_used + 1
     or NEW.transfers_used > 1 then
    raise exception 'SF transfer update must use exactly one incoming player';
  end if;

  -- Every slot must be a valid real player, a valid empty starter slot, or the
  -- bench wildcard (real or, for R16-exception squads, an empty wildcard).
  select count(*) into v_valid_slots
  from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as o(player, ord)
  full join jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
    using (ord)
  left join public.player_pool pp
    on pp.nation = x.player->>'nation' and pp.name = x.player->>'name'
  where jsonb_typeof(x.player) = 'object'
    and (x.player->>'slot') ~ '^[0-9]+$'
    and (x.player->>'slot')::int = (x.ord - 1)
    and (
      (
        -- Empty starter slot (0-10).
        (x.ord - 1) between 0 and 10
        and coalesce((x.player->>'empty')::boolean, false)
        and not coalesce((x.player->>'wild')::boolean, false)
        and x.player->>'role' = public.entry_slot_role((x.ord - 1)::int)
        and nullif(x.player->>'name', '') is null
        and nullif(x.player->>'nation', '') is null
      )
      or
      (
        -- Empty bench wildcard slot (11), left by the R16 wildcard exception.
        (x.ord - 1) = 11
        and coalesce((x.player->>'empty')::boolean, false)
        and coalesce((x.player->>'wild')::boolean, false)
        and nullif(x.player->>'name', '') is null
        and nullif(x.player->>'nation', '') is null
        and nullif(x.player->>'role', '') is null
      )
      or
      (
        -- Real player: unchanged, or a legal new incoming.
        pp.name is not null
        and not coalesce((x.player->>'empty')::boolean, false)
        and (
          (x.player is not distinct from o.player)
          or
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
            and not (x.player ? 'roles')
          )
        )
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
            and x.player->>'role' = public.entry_slot_role((x.ord - 1)::int)
            and pp.roles @> array[x.player->>'role']
          )
        )
      )
    );

  if v_valid_slots <> 12 then
    raise exception 'Squad contains invalid player, role, or empty slot data';
  end if;

  select count(*) into v_old_empty_slots
  from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
  where (x.ord - 1) between 0 and 10 and coalesce((x.player->>'empty')::boolean, false);

  select count(*) into v_new_empty_slots
  from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
  where (x.ord - 1) between 0 and 10 and coalesce((x.player->>'empty')::boolean, false);

  if v_new_empty_slots <> v_old_empty_slots + 2 then
    raise exception 'SF transfer must add exactly two new empty starter slots';
  end if;

  with old_rows as (
    select x.ord, x.player from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
  ),
  new_rows as (
    select x.ord, x.player from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
  ),
  changed as (
    select o.ord, o.player as old_player, n.player as new_player
    from old_rows o join new_rows n using (ord)
    where (o.player->>'name') is distinct from (n.player->>'name')
       or (o.player->>'nation') is distinct from (n.player->>'nation')
       or coalesce((o.player->>'empty')::boolean, false) is distinct from coalesce((n.player->>'empty')::boolean, false)
  )
  select
    count(*) filter (
      where (ord - 1) between 0 and 10
        and not coalesce((old_player->>'wild')::boolean, false)
        and not coalesce((old_player->>'empty')::boolean, false)
        and coalesce((new_player->>'empty')::boolean, false)
    ),
    count(*) filter (
      where (ord - 1) between 0 and 10
        and not coalesce((old_player->>'wild')::boolean, false)
        and not coalesce((old_player->>'empty')::boolean, false)
        and not coalesce((new_player->>'empty')::boolean, false)
        and not coalesce((new_player->>'wild')::boolean, false)
        and new_player->>'role' = public.entry_slot_role((ord - 1)::int)
    )
  into v_emptied_slots, v_refilled_slots
  from changed;

  if v_changed_slots <> 3 or v_emptied_slots <> 2 or v_refilled_slots <> 1 then
    raise exception 'SF transfer must be exactly 3 out, 1 in, and 2 new empty slots';
  end if;

  select count(*) into v_old_real_slots
  from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) as x(player)
  where not coalesce((x.player->>'empty')::boolean, false)
    and nullif(x.player->>'name', '') is not null;

  select count(*), count(distinct (x.player->>'nation') || chr(31) || (x.player->>'name'))
    into v_real_slots, v_distinct_players
  from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) as x(player)
  where not coalesce((x.player->>'empty')::boolean, false)
    and nullif(x.player->>'name', '') is not null;

  if v_real_slots <> v_old_real_slots - 2 then
    raise exception 'SF transfer must remove exactly two net real players';
  end if;

  if v_distinct_players <> v_real_slots then
    raise exception 'Squad cannot contain duplicate players';
  end if;

  select coalesce(max(n), 0) into v_max_nation_count
  from (
    select x.player->>'nation' as nation, count(*) as n
    from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) as x(player)
    where not coalesce((x.player->>'empty')::boolean, false)
      and nullif(x.player->>'nation', '') is not null
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

  if NEW.xi_json_gw2 is distinct from OLD.xi_json_gw2
     or NEW.xi_json_gw3 is distinct from OLD.xi_json_gw3
     or NEW.xi_json_r32 is distinct from OLD.xi_json_r32
     or NEW.xi_json_r16 is distinct from OLD.xi_json_r16
     or NEW.xi_json_qf is distinct from OLD.xi_json_qf then
    raise exception 'Squad snapshots cannot change';
  end if;

  return NEW;
end;
$$;

drop trigger if exists guard_locked_entry_transfer_trg on public.entries;
create trigger guard_locked_entry_transfer_trg
  before update on public.entries
  for each row execute function public.guard_locked_entry_transfer();

create or replace function public.entry_nations_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.entry_nations where entry_id = NEW.id;
  insert into public.entry_nations(entry_id, nation)
  select distinct NEW.id, x.player->>'nation'
  from jsonb_array_elements(
    coalesce(NEW.xi_json, '[]'::jsonb)
    || coalesce(NEW.xi_json_gw1, '[]'::jsonb)
    || coalesce(NEW.xi_json_gw2, '[]'::jsonb)
    || coalesce(NEW.xi_json_gw3, '[]'::jsonb)
    || coalesce(NEW.xi_json_r32, '[]'::jsonb)
    || coalesce(NEW.xi_json_r16, '[]'::jsonb)
    || coalesce(NEW.xi_json_qf, '[]'::jsonb)
  ) as x(player)
  where nullif(x.player->>'nation', '') is not null;
  return NEW;
end;
$$;

drop trigger if exists entries_xi_sync_trg on public.entries;
create trigger entries_xi_sync_trg
  after insert or update of xi_json, xi_json_gw1, xi_json_gw2, xi_json_gw3, xi_json_r32, xi_json_r16, xi_json_qf on public.entries
  for each row execute function public.entry_nations_sync();

truncate public.entry_nations;

insert into public.entry_nations(entry_id, nation)
select distinct e.id, x.player->>'nation'
from public.entries e
cross join lateral jsonb_array_elements(
  coalesce(e.xi_json, '[]'::jsonb)
  || coalesce(e.xi_json_gw1, '[]'::jsonb)
  || coalesce(e.xi_json_gw2, '[]'::jsonb)
  || coalesce(e.xi_json_gw3, '[]'::jsonb)
  || coalesce(e.xi_json_r32, '[]'::jsonb)
  || coalesce(e.xi_json_r16, '[]'::jsonb)
  || coalesce(e.xi_json_qf, '[]'::jsonb)
) as x(player)
where nullif(x.player->>'nation', '') is not null;

select
  l.transfers_open_until,
  count(*) filter (where e.xi_json_qf is not null) as qf_snapshots,
  count(*) filter (where coalesce(e.transfers_used, 0) = 0) as zero_transfer_counters,
  count(*) as entries
from public.leagues l
join public.entries e on e.league_id = l.id
where l.id = '11111111-1111-1111-1111-111111111111'
group by l.transfers_open_until;
