-- Open the MD3 transfer window safely.
--
-- What this does:
--   1) Adds a GW2 squad snapshot column.
--   2) Freezes every existing entry's current XI into xi_json_gw2 BEFORE
--      reopening transfers. That XI continues scoring all MD2 fixtures.
--   3) Resets transfers_used to 0 as the MD3 per-window counter.
--   4) Reopens transfers until the MD3 deadline:
--        2026-06-24 19:00 UTC = 22:00 Cairo.
--   5) Updates guards/validation so clients cannot edit GW snapshots,
--      forge transfer counts, submit invalid squads, or prefill snapshots.
--   6) Rebuilds entry_nations from xi_json + xi_json_gw1 + xi_json_gw2 so
--      score-day still finds entries whose MD2 players were later transferred.
--
-- Important: the backfill/reset block only runs if the league is not already
-- opened to the MD3 deadline, so rerunning this script will not erase MD3
-- transfer counts after users start making moves.

set statement_timeout = '5min';

alter table public.entries
  add column if not exists xi_json_gw2 jsonb;

do $$
declare
  v_md3_deadline constant timestamptz := '2026-06-24 19:00:00+00';
  v_previous_window timestamptz;
  v_reset_entries int := 0;
begin
  select transfers_open_until
    into v_previous_window
  from public.leagues
  where id = '11111111-1111-1111-1111-111111111111';

  if v_previous_window is distinct from v_md3_deadline then
    if exists (
      select 1 from pg_trigger
      where tgrelid = 'public.entries'::regclass
        and tgname = 'guard_locked_entry_transfer_trg'
    ) then
      execute 'alter table public.entries disable trigger guard_locked_entry_transfer_trg';
    end if;

    if exists (
      select 1 from pg_trigger
      where tgrelid = 'public.entries'::regclass
        and tgname = 'log_entry_transfer_update_trg'
    ) then
      execute 'alter table public.entries disable trigger log_entry_transfer_update_trg';
    end if;

    begin
      update public.entries
         set xi_json_gw2 = coalesce(xi_json_gw2, xi_json),
             transfers_used = 0
       where league_id = '11111111-1111-1111-1111-111111111111'
         and (
           xi_json_gw2 is null
           or coalesce(transfers_used, 0) <> 0
         );

      get diagnostics v_reset_entries = row_count;
    exception when others then
      if exists (
        select 1 from pg_trigger
        where tgrelid = 'public.entries'::regclass
          and tgname = 'guard_locked_entry_transfer_trg'
      ) then
        execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
      end if;

      if exists (
        select 1 from pg_trigger
        where tgrelid = 'public.entries'::regclass
          and tgname = 'log_entry_transfer_update_trg'
      ) then
        execute 'alter table public.entries enable trigger log_entry_transfer_update_trg';
      end if;

      raise;
    end;

    if exists (
      select 1 from pg_trigger
      where tgrelid = 'public.entries'::regclass
        and tgname = 'guard_locked_entry_transfer_trg'
    ) then
      execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
    end if;

    if exists (
      select 1 from pg_trigger
      where tgrelid = 'public.entries'::regclass
        and tgname = 'log_entry_transfer_update_trg'
    ) then
      execute 'alter table public.entries enable trigger log_entry_transfer_update_trg';
    end if;
  end if;

  update public.leagues
     set transfers_open_until = v_md3_deadline
   where id = '11111111-1111-1111-1111-111111111111';

  raise notice 'MD3 transfer window prepared. entries_reset=% previous_window=%',
    v_reset_entries, v_previous_window;
end;
$$;

create or replace function public.validate_late_joiner_randomizer_shape(p_xi jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_nation_count int;
  v_max_category_count int;
  v_roles_key_count int;
  v_wild_count int;
begin
  if jsonb_typeof(p_xi) <> 'array' then
    raise exception 'Late first submission must contain exactly 12 players';
  end if;

  if jsonb_array_length(p_xi) <> 12 then
    raise exception 'Late first submission must contain exactly 12 players';
  end if;

  select count(*)
    into v_wild_count
  from jsonb_array_elements(p_xi) with ordinality as x(player, ord)
  where coalesce((x.player->>'wild')::boolean, false)
    and x.ord = 12
    and nullif(x.player->>'role', '') is null;

  if v_wild_count <> 1 then
    raise exception 'Late first submission must keep exactly one wildcard in slot 11';
  end if;

  select coalesce(max(n), 0)
    into v_max_nation_count
  from (
    select x.player->>'nation' as nation, count(*) as n
    from jsonb_array_elements(p_xi) as x(player)
    group by x.player->>'nation'
  ) counts;

  if v_max_nation_count > 1 then
    raise exception 'Late first submission must use one player per nation';
  end if;

  select coalesce(max(n), 0)
    into v_max_category_count
  from (
    select (x.player->>'category')::int as category, count(*) as n
    from jsonb_array_elements(p_xi) as x(player)
    group by (x.player->>'category')::int
  ) counts;

  if v_max_category_count > 2 then
    raise exception 'Late first submission cannot use more than two players from one category';
  end if;

  select count(*)
    into v_roles_key_count
  from jsonb_array_elements(p_xi) as x(player)
  where x.player ? 'roles';

  if v_roles_key_count > 0 then
    raise exception 'Late first submission cannot include derived role arrays';
  end if;
end;
$$;

revoke all on function public.validate_late_joiner_randomizer_shape(jsonb)
from public, anon, authenticated;

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

    if NEW.xi_json_gw1 is not null then
      perform public.validate_entry_xi_json(NEW.xi_json_gw1);
    end if;

    if NEW.xi_json_gw2 is not null then
      perform public.validate_entry_xi_json(NEW.xi_json_gw2);
    end if;
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

      if NEW.xi_json_gw1 is not null or NEW.xi_json_gw2 is not null then
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
  before insert or update of xi_json, xi_json_gw1, xi_json_gw2 on public.entries
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
  v_distinct_players int;
  v_arab_count int;
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

  -- Server-maintained fields such as rank_current/rank_previous may still
  -- update after transfer windows close. Only allow this path when squad,
  -- snapshot, transfer, ownership, and submission fields are unchanged, and
  -- never for authenticated client requests.
  if NEW.xi_json is not distinct from OLD.xi_json
     and NEW.xi_json_gw1 is not distinct from OLD.xi_json_gw1
     and NEW.xi_json_gw2 is not distinct from OLD.xi_json_gw2
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

  if NEW.xi_json is not distinct from OLD.xi_json
     and NEW.xi_json_gw1 is not distinct from OLD.xi_json_gw1
     and NEW.xi_json_gw2 is not distinct from OLD.xi_json_gw2
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
     or NEW.rank_previous is distinct from OLD.rank_previous
     or NEW.xi_json_gw2 is distinct from OLD.xi_json_gw2 then
    raise exception 'Only transfer updates are allowed after lock';
  end if;

  v_total_slots := jsonb_array_length(coalesce(NEW.xi_json, '[]'::jsonb));
  if v_total_slots <> 12 then
    raise exception 'Squad must contain exactly 12 players';
  end if;

  select count(*) into v_changed_slots
  from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as o(player, ord)
  full join jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as n(player, ord)
    using (ord)
  where (o.player->>'name') is distinct from (n.player->>'name')
     or (o.player->>'nation') is distinct from (n.player->>'nation');

  with old_rows as (
    select x.ord, x.player
    from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
  ),
  new_rows as (
    select x.ord, x.player
    from jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as x(player, ord)
  ),
  changed as (
    select o.ord, o.player as old_player, n.player as new_player
    from old_rows o
    join new_rows n using (ord)
    where (o.player->>'name') is distinct from (n.player->>'name')
       or (o.player->>'nation') is distinct from (n.player->>'nation')
  ),
  old_wild as (
    select ord, player
    from old_rows
    where coalesce((player->>'wild')::boolean, false)
  ),
  new_wild as (
    select ord, player
    from new_rows
    where coalesce((player->>'wild')::boolean, false)
  )
  select exists (
    select 1
    from changed starter_change
    cross join old_wild ow
    cross join new_wild nw
    join public.player_pool wild_pp
      on wild_pp.nation = ow.player->>'nation'
     and wild_pp.name = ow.player->>'name'
    where v_changed_slots = 2
      and (select count(*) from old_wild) = 1
      and (select count(*) from new_wild) = 1
      and ow.ord = 12
      and nw.ord = 12
      and (ow.player->>'slot') ~ '^[0-9]+$'
      and (ow.player->>'slot')::int = 11
      and (starter_change.old_player->>'slot') ~ '^[0-9]+$'
      and (starter_change.old_player->>'slot')::int = starter_change.ord - 1
      and not coalesce((starter_change.old_player->>'wild')::boolean, false)
      and not coalesce((starter_change.new_player->>'wild')::boolean, false)
      and starter_change.new_player->>'name' = ow.player->>'name'
      and starter_change.new_player->>'nation' = ow.player->>'nation'
      and (starter_change.new_player->>'slot') ~ '^[0-9]+$'
      and (starter_change.new_player->>'slot')::int = starter_change.ord - 1
      and starter_change.new_player->>'role' = case
        when starter_change.ord - 1 = 0 then 'GK'
        when starter_change.ord - 1 in (1, 2) then 'CB'
        when starter_change.ord - 1 in (3, 4) then 'FB'
        when starter_change.ord - 1 in (5, 6) then 'CM'
        when starter_change.ord - 1 in (7, 8) then 'WIN'
        when starter_change.ord - 1 in (9, 10) then 'ST'
      end
      and wild_pp.roles @> array[starter_change.new_player->>'role']
      and nw.player->>'name' = starter_change.old_player->>'name'
      and nw.player->>'nation' = starter_change.old_player->>'nation'
      and (nw.player->>'slot') ~ '^[0-9]+$'
      and (nw.player->>'slot')::int = 11
      and nullif(nw.player->>'role', '') is null
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

    return NEW;
  end if;

  if NEW.transfers_used is distinct from OLD.transfers_used + 2
     or NEW.transfers_used > 2 then
    raise exception 'Transfer update must use exactly two transfers';
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
      (o.player is not null and x.player = o.player)
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
  ) as x(player)
  where x.player ? 'nation';

  return NEW;
end;
$$;

drop trigger if exists entries_xi_sync_trg on public.entries;
create trigger entries_xi_sync_trg
  after insert or update of xi_json, xi_json_gw1, xi_json_gw2 on public.entries
  for each row execute function public.entry_nations_sync();

truncate public.entry_nations;

insert into public.entry_nations(entry_id, nation)
select distinct e.id, x.player->>'nation'
from public.entries e
cross join lateral jsonb_array_elements(
  coalesce(e.xi_json, '[]'::jsonb)
  || coalesce(e.xi_json_gw1, '[]'::jsonb)
  || coalesce(e.xi_json_gw2, '[]'::jsonb)
) as x(player)
where x.player ? 'nation';

create or replace function public.entries_for_nations(p_nations text[])
returns setof public.entries
language sql
security definer
set search_path = public
as $$
  select distinct e.*
  from public.entries e
  where exists (
    select 1
    from public.entry_nations en
    where en.entry_id = e.id
      and en.nation = any(p_nations)
  )
  order by e.id
$$;

revoke all on function public.entries_for_nations(text[])
from public, anon, authenticated;

select
  l.transfers_open_until,
  count(*) filter (where e.xi_json_gw2 is not null) as gw2_snapshots,
  count(*) filter (where coalesce(e.transfers_used, 0) = 0) as zero_transfer_counters,
  count(*) as entries
from public.leagues l
join public.entries e on e.league_id = l.id
where l.id = '11111111-1111-1111-1111-111111111111'
group by l.transfers_open_until;
