-- Remove invalid/suspicious main-leaderboard entry.
--
-- User ruling: remove `kero0` entirely and wipe its scores.
--
-- Scope:
--   - Entry: 0eb1eb98-49e5-40a6-ad15-e85a0f75814b
--   - Team:  kero0
--
-- Safety:
--   - Fails unless the exact entry id + team name match.
--   - Deletes only score/lookup/audit rows for this entry id.
--   - Refresh cached leaderboards/ranks separately after this file succeeds.

set statement_timeout = '5min';

do $$
declare
  v_entry_id constant uuid := '0eb1eb98-49e5-40a6-ad15-e85a0f75814b';
  v_team_name text;
  v_score_rows int := 0;
  v_nation_rows int := 0;
  v_log_rows int := 0;
  v_entry_rows int := 0;
begin
  select team_name
    into v_team_name
  from public.entries
  where id = v_entry_id;

  if v_team_name is distinct from 'kero0' then
    raise exception 'Refusing to delete: expected entry % team kero0, found %',
      v_entry_id, coalesce(v_team_name, '<missing>');
  end if;

  delete from public.scores
   where entry_id = v_entry_id;
  get diagnostics v_score_rows = row_count;

  delete from public.entry_nations
   where entry_id = v_entry_id;
  get diagnostics v_nation_rows = row_count;

  delete from public.transfer_logs
   where entry_id = v_entry_id;
  get diagnostics v_log_rows = row_count;

  delete from public.entries
   where id = v_entry_id
     and team_name = 'kero0';
  get diagnostics v_entry_rows = row_count;

  if v_entry_rows <> 1 then
    raise exception 'Expected to delete exactly one kero0 entry, deleted %', v_entry_rows;
  end if;

  raise notice 'Removed kero0 entry %. scores=%, entry_nations=%, transfer_logs=%, entries=%',
    v_entry_id, v_score_rows, v_nation_rows, v_log_rows, v_entry_rows;
end $$;

-- Verification: should return no rows.
select id, team_name
from public.entries
where id = '0eb1eb98-49e5-40a6-ad15-e85a0f75814b'
   or team_name = 'kero0';

-- Verification: should return no rows.
select entry_id, count(*) as score_rows
from public.scores
where entry_id = '0eb1eb98-49e5-40a6-ad15-e85a0f75814b'
group by entry_id;

-- Note: public.leaderboard_totals is materialized and must be refreshed in a
-- separate statement after this file succeeds.
