-- Harden entries UPDATE RLS with an explicit WITH CHECK.
--
-- Why:
--   The transfer-window update policy already limits which existing rows a
--   user may update. WITH CHECK repeats the same constraint against the new
--   row, so a crafted PATCH cannot rely on policy ambiguity around updated
--   ownership/league/window fields. The transfer guard trigger still enforces
--   the actual "exactly two valid transfers" rule.
--
-- Run in Supabase SQL Editor.

drop policy if exists "entries update self open" on public.entries;

create policy "entries update self open" on public.entries
  for update
  using (
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
  )
  with check (
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

select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'entries'
  and policyname = 'entries update self open';
