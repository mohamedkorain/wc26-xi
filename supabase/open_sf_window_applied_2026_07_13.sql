set statement_timeout='5min';

-- Freeze xi_json_qf + reset transfer counters + set the SF deadline.
-- xi_json_qf is now in the validate/xi_sync trigger column lists, so writing it
-- fires those per-row triggers; disable all four heavy triggers for the bulk
-- write (entry_nations already contains the xi_json nations, which equal the
-- xi_json_qf snapshot, so skipping the sync trigger is safe).
do $$
declare
  v_sf_deadline constant timestamptz := '2026-07-14 19:00:00+00';
  v_reset int := 0;
begin
  alter table public.entries disable trigger guard_locked_entry_transfer_trg;
  alter table public.entries disable trigger log_entry_transfer_update_trg;
  alter table public.entries disable trigger validate_entry_lineup_write_trg;
  alter table public.entries disable trigger entries_xi_sync_trg;

  begin
    update public.entries
       set xi_json_qf = coalesce(xi_json_qf, xi_json),
           transfers_used = 0
     where league_id = '11111111-1111-1111-1111-111111111111'
       and (xi_json_qf is null or coalesce(transfers_used, 0) <> 0);
    get diagnostics v_reset = row_count;
  exception when others then
    alter table public.entries enable trigger guard_locked_entry_transfer_trg;
    alter table public.entries enable trigger log_entry_transfer_update_trg;
    alter table public.entries enable trigger validate_entry_lineup_write_trg;
    alter table public.entries enable trigger entries_xi_sync_trg;
    raise;
  end;

  alter table public.entries enable trigger guard_locked_entry_transfer_trg;
  alter table public.entries enable trigger log_entry_transfer_update_trg;
  alter table public.entries enable trigger validate_entry_lineup_write_trg;
  alter table public.entries enable trigger entries_xi_sync_trg;

  update public.leagues
     set transfers_open_until = v_sf_deadline
   where id = '11111111-1111-1111-1111-111111111111';

  raise notice 'SF window opened. rows_touched=%', v_reset;
end;
$$;

select
  (select transfers_open_until from public.leagues where id='11111111-1111-1111-1111-111111111111') as deadline,
  count(*) filter (where xi_json_qf is not null) as qf_frozen,
  count(*) filter (where coalesce(transfers_used,0)=0) as zero_tu,
  count(*) filter (where xi_json_qf is distinct from xi_json) as qf_differs,
  count(*) as total
from public.entries
where league_id='11111111-1111-1111-1111-111111111111';
