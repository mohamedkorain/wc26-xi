-- Remove client-side league deletion.
--
-- Why:
--   entries.league_id cascades from leagues. During the live tournament, no
--   browser/client role should be able to delete a league even if the league
--   owner account is compromised. Admin cleanup can still use SQL
--   Editor/service_role.
--
-- Run in Supabase SQL Editor.

drop policy if exists "leagues delete owner" on public.leagues;

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'leagues'
order by policyname;
