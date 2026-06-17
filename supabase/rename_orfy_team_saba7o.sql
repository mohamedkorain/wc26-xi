-- Rename Orfy/Nsoo7y presenter entry from "Ya 3otle" to "Saba7o".
--
-- Scope:
--   - Only entry 8bf0e040-6920-4a8b-9909-63afca7ca413 / user
--     81ad546e-bf02-4b98-92dd-de20b8e2a6b6
--   - Disables only the post-lock transfer guard around this admin metadata
--     correction, then refreshes cached leaderboard totals/ranks.

set statement_timeout = '5min';

do $$
declare
  v_updated int;
begin
  execute 'alter table public.entries disable trigger guard_locked_entry_transfer_trg';

  update public.entries
     set team_name = 'Saba7o'
   where id = '8bf0e040-6920-4a8b-9909-63afca7ca413'
     and user_id = '81ad546e-bf02-4b98-92dd-de20b8e2a6b6';

  get diagnostics v_updated = row_count;

  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';

  if v_updated <> 1 then
    raise exception 'Expected to update exactly one Orfy/Nsoo7y entry, updated %', v_updated;
  end if;
exception
  when others then
    begin
      execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
    exception when others then
      null;
    end;
    raise;
end $$;

select public.refresh_leaderboard_and_ranks();

select e.id, e.team_name, lt.team_name as cached_team_name, lt.total_points, e.rank_current
from public.entries e
left join public.leaderboard_totals lt on lt.entry_id = e.id
where e.id = '8bf0e040-6920-4a8b-9909-63afca7ca413';
