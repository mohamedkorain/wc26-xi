-- Run this ONCE after schema.sql. Creates the single HALO AMRIKA league
-- and relaxes owner_id so we don't need a fake user account.

alter table public.leagues alter column owner_id drop not null;

insert into public.leagues (id, code, name, owner_id, locked_at)
values (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'HALO',
  'HALO AMRIKA',
  null,
  '2026-06-11 15:00:00+00'   -- 1h before kickoff, Cairo time (UTC+3)
)
on conflict (id) do update set
  name      = excluded.name,
  locked_at = excluded.locked_at;

-- Loosen entries policies so anyone signed in can submit to the global league
drop policy if exists "entries insert self open" on public.entries;
drop policy if exists "entries update self open" on public.entries;
create policy "entries insert self open" on public.entries
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.leagues l
      where l.id = league_id and now() < l.locked_at
    )
  );
create policy "entries update self open" on public.entries
  for update using (
    auth.uid() = user_id
    and exists (
      select 1 from public.leagues l
      where l.id = league_id and now() < l.locked_at
    )
  );
