-- Remove severe invalid randomizer/late-joiner entries from the main league.
--
-- User ruling: remove the high-confidence suspicious set only.
--
-- Scope:
--   - 6 entries from the top-1000 audit with impossible original/randomizer
--     squad shape:
--       * repeated nations in the original/randomizer squad, or
--       * 4+ players from one category where the browser randomizer cap was 2.
--
-- Safety:
--   - Deletes only the exact entry IDs listed in expected_entries.
--   - Fails unless all 6 entries still exist.
--   - Snapshots entry, score, and transfer-log evidence first.
--   - Refresh cached leaderboards/ranks separately after this file succeeds.

set statement_timeout = '5min';

create table if not exists public.disqualified_entries (
  entry_id uuid primary key,
  league_id uuid not null,
  user_id uuid,
  team_name text not null,
  email text,
  total_points int,
  rank_current int,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  entry_snapshot jsonb not null,
  score_snapshot jsonb not null default '[]'::jsonb,
  transfer_log_snapshot jsonb not null default '[]'::jsonb,
  disqualified_at timestamptz not null default now(),
  disqualified_by text not null default current_user,
  notes text
);

alter table public.disqualified_entries enable row level security;
revoke all on public.disqualified_entries from anon, authenticated;

do $$
declare
  v_expected_count constant int := 6;
  v_existing_count int := 0;
  v_audit_rows int := 0;
  v_score_rows int := 0;
  v_nation_rows int := 0;
  v_log_rows int := 0;
  v_entry_rows int := 0;
begin
  create temporary table expected_entries (
    entry_id uuid primary key,
    reason text not null,
    evidence jsonb not null
  ) on commit drop;

  insert into expected_entries(entry_id, reason, evidence) values
    (
      '5282a895-d84e-4af6-996a-e9f8cdfc09c0',
      'severe invalid original randomizer shape',
      jsonb_build_object(
        'team', 'winners',
        'rank_at_audit', 2,
        'points_at_audit', 51,
        'initial_source', 'xi_json_gw1',
        'repeated_categories', '1:4, 3:3, 4:3',
        'repeated_nations', null
      )
    ),
    (
      '8984246c-9ac3-42d1-ad7f-cfc61e06e7f3',
      'severe invalid original randomizer shape',
      jsonb_build_object(
        'team', 'Dream Team',
        'rank_at_audit', 25,
        'points_at_audit', 45,
        'initial_source', 'xi_json_gw1',
        'repeated_categories', '1:8',
        'repeated_nations', 'Argentina:2, France:2, Spain:2'
      )
    ),
    (
      'e8541314-c390-4d41-93d7-20e44a457662',
      'severe invalid original randomizer shape',
      jsonb_build_object(
        'team', 'Dream XI planted snapshot',
        'rank_at_audit', 134,
        'points_at_audit', 42,
        'initial_source', 'xi_json_gw1',
        'repeated_categories', '1:8',
        'repeated_nations', null
      )
    ),
    (
      'c5a455b1-9c79-4853-a9c3-540c8374e222',
      'severe invalid original randomizer shape',
      jsonb_build_object(
        'team', 'Arabic team name, rank 233 at audit',
        'rank_at_audit', 233,
        'points_at_audit', 40,
        'initial_source', 'xi_json_gw2',
        'repeated_categories', '1:4',
        'repeated_nations', null
      )
    ),
    (
      '26e84efd-b56a-43e7-a5cd-b3532ea3ab87',
      'severe invalid original randomizer shape',
      jsonb_build_object(
        'team', 'g9g',
        'rank_at_audit', 303,
        'points_at_audit', 40,
        'initial_source', 'xi_json_gw2',
        'repeated_categories', '1:9',
        'repeated_nations', 'Spain:3, France:2'
      )
    ),
    (
      '0693b9c1-3688-48ff-87e6-58817ff4f4dd',
      'severe invalid original randomizer shape',
      jsonb_build_object(
        'team', 'AhmadZDev',
        'rank_at_audit', 875,
        'points_at_audit', 36,
        'initial_source', 'xi_json_gw2',
        'repeated_categories', '1:6, 2:3',
        'repeated_nations', null
      )
    );

  select count(*)
    into v_existing_count
  from public.entries e
  join expected_entries x on x.entry_id = e.id;

  if v_existing_count <> v_expected_count then
    raise exception 'Refusing to delete: expected % live entries, found %',
      v_expected_count, v_existing_count;
  end if;

  insert into public.disqualified_entries (
    entry_id,
    league_id,
    user_id,
    team_name,
    email,
    total_points,
    rank_current,
    reason,
    evidence,
    entry_snapshot,
    score_snapshot,
    transfer_log_snapshot,
    notes
  )
  select
    e.id,
    e.league_id,
    e.user_id,
    e.team_name,
    au.email,
    lt.total_points,
    e.rank_current,
    x.reason,
    x.evidence || jsonb_build_object(
      'submitted_at', e.submitted_at,
      'transfers_used', e.transfers_used
    ),
    to_jsonb(e),
    coalesce((
      select jsonb_agg(to_jsonb(s) order by s.match_date)
      from public.scores s
      where s.entry_id = e.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(tl) order by tl.changed_at)
      from public.transfer_logs tl
      where tl.entry_id = e.id
    ), '[]'::jsonb),
    'Removed on 2026-06-23 after top-1000 audit found severe impossible randomizer shape.'
  from expected_entries x
  join public.entries e on e.id = x.entry_id
  left join auth.users au on au.id = e.user_id
  left join public.leaderboard_totals lt on lt.entry_id = e.id
  on conflict (entry_id) do update
    set league_id = excluded.league_id,
        user_id = excluded.user_id,
        team_name = excluded.team_name,
        email = excluded.email,
        total_points = excluded.total_points,
        rank_current = excluded.rank_current,
        reason = excluded.reason,
        evidence = excluded.evidence,
        entry_snapshot = excluded.entry_snapshot,
        score_snapshot = excluded.score_snapshot,
        transfer_log_snapshot = excluded.transfer_log_snapshot,
        disqualified_at = now(),
        disqualified_by = current_user,
        notes = excluded.notes;
  get diagnostics v_audit_rows = row_count;

  delete from public.scores
   where entry_id in (select entry_id from expected_entries);
  get diagnostics v_score_rows = row_count;

  delete from public.entry_nations
   where entry_id in (select entry_id from expected_entries);
  get diagnostics v_nation_rows = row_count;

  delete from public.transfer_logs
   where entry_id in (select entry_id from expected_entries);
  get diagnostics v_log_rows = row_count;

  delete from public.entries
   where id in (select entry_id from expected_entries);
  get diagnostics v_entry_rows = row_count;

  if v_entry_rows <> v_expected_count then
    raise exception 'Expected to delete % entries, deleted %',
      v_expected_count, v_entry_rows;
  end if;

  raise notice 'Removed severe invalid entries. audit_upserts=%, scores=%, entry_nations=%, transfer_logs=%, entries=%',
    v_audit_rows, v_score_rows, v_nation_rows, v_log_rows, v_entry_rows;
end $$;

-- Verification: should return no rows.
select id, team_name
from public.entries
where id in (
  '5282a895-d84e-4af6-996a-e9f8cdfc09c0',
  '8984246c-9ac3-42d1-ad7f-cfc61e06e7f3',
  'e8541314-c390-4d41-93d7-20e44a457662',
  'c5a455b1-9c79-4853-a9c3-540c8374e222',
  '26e84efd-b56a-43e7-a5cd-b3532ea3ab87',
  '0693b9c1-3688-48ff-87e6-58817ff4f4dd'
);

-- Verification: should return 6 audit rows.
select entry_id, team_name, email, total_points, rank_current, evidence
from public.disqualified_entries
where entry_id in (
  '5282a895-d84e-4af6-996a-e9f8cdfc09c0',
  '8984246c-9ac3-42d1-ad7f-cfc61e06e7f3',
  'e8541314-c390-4d41-93d7-20e44a457662',
  'c5a455b1-9c79-4853-a9c3-540c8374e222',
  '26e84efd-b56a-43e7-a5cd-b3532ea3ab87',
  '0693b9c1-3688-48ff-87e6-58817ff4f4dd'
)
order by total_points desc, rank_current asc;

-- Note: public.leaderboard_totals is materialized and must be refreshed in a
-- separate statement after this file succeeds.
