-- wc26-xi schema · run this once in Supabase SQL Editor
-- Project: nyytjswemjrybjfmqaaq

-- ─── profiles (one row per signed-up user) ─────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  display_name text,
  created_at  timestamptz not null default now()
);

-- auto-create a profile row whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── leagues ───────────────────────────────────────────────────────────
create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,                    -- short shareable code, e.g. "WC26-ALPHA"
  name        text not null,
  owner_id    uuid not null references auth.users on delete cascade,
  locked_at   timestamptz not null default '2026-06-11 16:00:00+00',  -- WC26 kickoff
  created_at  timestamptz not null default now()
);
create index if not exists leagues_owner_idx on public.leagues(owner_id);

-- ─── league_members ────────────────────────────────────────────────────
create table if not exists public.league_members (
  league_id   uuid not null references public.leagues on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- ─── entries (one XI per user per league) ──────────────────────────────
create table if not exists public.entries (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  team_name     text not null,
  formation     text not null,
  xi_json       jsonb not null,
  submitted_at  timestamptz not null default now(),
  unique (league_id, user_id)
);
create index if not exists entries_league_idx on public.entries(league_id);

-- ─── matches + goal_events + scores (Phase 3, scoring) ─────────────────
create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  external_id  text unique,        -- e.g. football-data.org match id
  date         date not null,
  home         text not null,
  away         text not null,
  home_goals   int,
  away_goals   int,
  status       text not null default 'scheduled'   -- scheduled | live | finished
);

create table if not exists public.goal_events (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches on delete cascade,
  player_name  text not null,
  nation       text not null,
  minute       int,
  is_assist    boolean not null default false
);
create index if not exists goal_events_match_idx on public.goal_events(match_id);
create index if not exists goal_events_player_idx on public.goal_events(player_name, nation);

create table if not exists public.scores (
  entry_id     uuid not null references public.entries on delete cascade,
  match_date   date not null,
  points       int not null default 0,
  breakdown    jsonb,                       -- {"goals": 2, "assists": 1, "clean_sheet": 0, ...}
  primary key (entry_id, match_date)
);
create index if not exists scores_entry_idx on public.scores(entry_id);

-- ─── Row-Level Security ────────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.leagues        enable row level security;
alter table public.league_members enable row level security;
alter table public.entries        enable row level security;
alter table public.matches        enable row level security;
alter table public.goal_events    enable row level security;
alter table public.scores         enable row level security;

-- profiles: a user reads/edits their own; anyone signed-in can read display_name
drop policy if exists "profiles read all"  on public.profiles;
drop policy if exists "profiles edit self" on public.profiles;
create policy "profiles read all"  on public.profiles for select using (true);
create policy "profiles edit self" on public.profiles for update using (auth.uid() = id);

-- leagues: anyone can read a league by id (so /league/[code] works for invitees).
-- Only owner can create/update/delete.
drop policy if exists "leagues read all"     on public.leagues;
drop policy if exists "leagues insert owner" on public.leagues;
drop policy if exists "leagues update owner" on public.leagues;
drop policy if exists "leagues delete owner" on public.leagues;
create policy "leagues read all"     on public.leagues for select using (true);
create policy "leagues insert owner" on public.leagues for insert with check (auth.uid() = owner_id);
create policy "leagues update owner" on public.leagues for update using (auth.uid() = owner_id);
create policy "leagues delete owner" on public.leagues for delete using (auth.uid() = owner_id);

-- league_members: members readable to everyone in the league; self-insert; self-delete.
drop policy if exists "members read all"   on public.league_members;
drop policy if exists "members join self"  on public.league_members;
drop policy if exists "members leave self" on public.league_members;
create policy "members read all"   on public.league_members for select using (true);
create policy "members join self"  on public.league_members for insert with check (auth.uid() = user_id);
create policy "members leave self" on public.league_members for delete using (auth.uid() = user_id);

-- entries: readable by anyone (leaderboards public), but only owner can write and only
-- if the league isn't locked yet.
drop policy if exists "entries read all"          on public.entries;
drop policy if exists "entries insert self open"  on public.entries;
drop policy if exists "entries update self open"  on public.entries;
create policy "entries read all" on public.entries for select using (true);
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

-- matches/goal_events/scores: read-only to clients (writes happen via service-role cron)
drop policy if exists "matches read all"     on public.matches;
drop policy if exists "goal_events read all" on public.goal_events;
drop policy if exists "scores read all"      on public.scores;
create policy "matches read all"     on public.matches     for select using (true);
create policy "goal_events read all" on public.goal_events for select using (true);
create policy "scores read all"      on public.scores      for select using (true);
