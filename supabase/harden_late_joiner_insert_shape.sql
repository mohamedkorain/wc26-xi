-- Harden late-joiner first submissions during the MD2 transfer window.
--
-- Problem:
--   New authenticated users can still INSERT their first entry while the
--   transfer window is open. The browser randomizer creates a one-player-per-
--   nation squad with at most two players per category, but a crafted direct
--   REST insert could previously submit any otherwise-valid xi_json up to
--   three players from one nation.
--
-- Scope:
--   - Applies only to client INSERTs after the original lock while transfers
--     remain open.
--   - Does not change existing entries or normal transfer UPDATE handling.
--   - Keeps admin/service SQL free for emergency corrections.

set statement_timeout = '5min';

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
begin
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

  -- The browser submit payload does not include derived multi-role arrays.
  -- Keeping them out of late client inserts prevents crafted JSON from trying
  -- to influence scorer role interpretation.
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

  -- Initial submissions and pre-lock edits must be fully canonical. After
  -- lock, existing-entry transfer updates are checked by
  -- guard_locked_entry_transfer_trg so legacy saved rows are not blocked by
  -- later player-metadata drift.
  if TG_OP = 'INSERT' or now() < v_locked_at then
    perform public.validate_entry_xi_json(NEW.xi_json);

    if NEW.xi_json_gw1 is not null then
      perform public.validate_entry_xi_json(NEW.xi_json_gw1);
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

      if NEW.xi_json_gw1 is not null then
        raise exception 'Late first submission cannot prefill original squad snapshot';
      end if;

      perform public.validate_late_joiner_randomizer_shape(NEW.xi_json);
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists validate_entry_lineup_write_trg on public.entries;
create trigger validate_entry_lineup_write_trg
  before insert or update of xi_json, xi_json_gw1 on public.entries
  for each row execute function public.validate_entry_lineup_write();

select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.entries'::regclass
  and tgname = 'validate_entry_lineup_write_trg';
