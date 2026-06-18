-- Allow first-time late joiners during an open transfer window.
--
-- Product rule:
--   - Existing locked teams must still use /team.html transfer controls.
--   - New users may draft a first squad with the randomizer while transfers
--     are open.
--   - Their submitted_at stays "now", so score-day gives them zero for MD1
--     and starts scoring them from MD2.
--   - Inserted squads are still fully validated by validate_entry_xi_json().

set statement_timeout = '5min';

drop policy if exists "entries insert self open" on public.entries;
create policy "entries insert self open" on public.entries
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.leagues l
      where l.id = league_id
        and (
          now() < l.locked_at
          or (
            l.transfers_open_until is not null
            and now() < l.transfers_open_until
          )
        )
    )
  );

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
    v_request_role := coalesce(current_setting('request.jwt.claim.role', true), '');

    if now() >= v_locked_at
       and not v_transfer_open
       and v_request_role in ('authenticated', 'anon') then
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

select policyname, cmd, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'entries'
  and policyname = 'entries insert self open';

select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.entries'::regclass
  and tgname = 'validate_entry_lineup_write_trg';
