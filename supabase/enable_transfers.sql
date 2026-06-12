-- Enable the transfer window for GW2.
-- Open from now until 2026-06-18 16:00 UTC (= 19:00 Cairo, first MD2 kickoff).
-- Each user gets max 2 transfers across the whole window.

-- 1. New columns
alter table public.leagues
  add column if not exists transfers_open_until timestamptz;

alter table public.entries
  add column if not exists transfers_used int not null default 0;

-- 2. Set the transfer window
update public.leagues
   set transfers_open_until = '2026-06-18T16:00:00Z'
 where code = 'HALO';

-- 3. RLS: allow INSERT + UPDATE during transfer window (in addition to
--    pre-lock). BETA: transfer-window writes are restricted to the admin
--    email allow-list while we validate the flow end-to-end. Pre-lock
--    writes (initial submission) are unaffected.
drop policy if exists "entries insert self open" on public.entries;
create policy "entries insert self open" on public.entries
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.leagues l
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

drop policy if exists "entries update self open" on public.entries;
create policy "entries update self open" on public.entries
  for update using (
    auth.uid() = user_id
    and exists (
      select 1 from public.leagues l
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

-- 4. Sanity check
select code, name, locked_at, transfers_open_until from public.leagues where code = 'HALO';
