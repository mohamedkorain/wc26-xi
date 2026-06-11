-- URGENT: hide emails from anon reads.
-- Replace the "profiles read all" policy (which leaked emails of all users)
-- with a "read own only" policy. Then expose ONLY display_name via a public
-- view that the leaderboard uses for joining.

-- Step 1: lock down direct reads of profiles
drop policy if exists "profiles read all" on public.profiles;
create policy "profiles read own" on public.profiles
  for select using (auth.uid() = id);

-- Step 2: public view that only exposes id + display_name (no email)
create or replace view public.profile_displays as
  select id, display_name from public.profiles;

grant select on public.profile_displays to anon, authenticated;
