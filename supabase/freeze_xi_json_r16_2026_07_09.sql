-- Freeze the R16 scoring squad into entries.xi_json_r16.
--
-- The R16 transfer window closed 2026-07-04 16:00 UTC, so current xi_json is
-- the squad that played the Round of 16 and no user can edit it right now.
-- We freeze it into xi_json_r16 so that:
--   - the QF qualification bonus (qf:2) reads a stable R16 snapshot, and
--   - once the QF transfer window opens, R16 fixtures keep scoring xi_json_r16
--     while QF+ scores the newly editable current xi_json.
--
-- This script only freezes the snapshot. It does NOT reset transfer counters,
-- change the deadline, or open the window. Idempotent: xi_json_r16 is only
-- populated where still null.

alter table public.entries
  add column if not exists xi_json_r16 jsonb;

do $$
declare
  v_frozen bigint := 0;
begin
  -- Whole-row UPDATE triggers would otherwise fire on this snapshot write.
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

  begin
    update public.entries
       set xi_json_r16 = xi_json
     where league_id = '11111111-1111-1111-1111-111111111111'
       and xi_json_r16 is null;
    get diagnostics v_frozen = row_count;
  exception when others then
    execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
    execute 'alter table public.entries enable trigger log_entry_transfer_update_trg';
    raise;
  end;

  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
  execute 'alter table public.entries enable trigger log_entry_transfer_update_trg';

  raise notice 'xi_json_r16 frozen for % entries', v_frozen;
end;
$$;

-- Verification: every entry should now have xi_json_r16, and it must equal
-- current xi_json (no edits are possible while the window is closed).
select
  count(*) as total_entries,
  count(*) filter (where xi_json_r16 is not null) as r16_snapshots,
  count(*) filter (where xi_json_r16 is null) as missing_r16,
  count(*) filter (where xi_json_r16 is distinct from xi_json) as snapshot_differs_from_current
from public.entries
where league_id = '11111111-1111-1111-1111-111111111111';
