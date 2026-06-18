-- Transfer/squad-change audit log.
--
-- Purpose:
--   Track future post-lock transfers and wildcard swaps with an exact DB
--   timestamp. This is intentionally database-level so direct Supabase calls
--   are logged too; it does not depend on client code.
--
-- Notes:
--   - This is not retroactive. Past transfers cannot be timestamped because
--     entries has no updated_at/history column.
--   - RLS is enabled with no anon/authenticated policies. Admin/service-role
--     queries can inspect it, but regular users cannot read or write it.

create table if not exists public.transfer_logs (
  id                  uuid primary key default gen_random_uuid(),
  entry_id            uuid not null references public.entries(id) on delete cascade,
  league_id           uuid not null,
  user_id             uuid not null,
  team_name           text,
  actor_user_id       uuid,
  actor_role          text,
  changed_at          timestamptz not null default now(),
  event_type          text not null,
  transfer_delta      int not null,
  old_transfers_used  int not null default 0,
  new_transfers_used  int not null default 0,
  changed_slots       jsonb not null,
  old_xi_json         jsonb not null,
  new_xi_json         jsonb not null
);

create index if not exists transfer_logs_entry_changed_idx
  on public.transfer_logs(entry_id, changed_at desc);

create index if not exists transfer_logs_league_changed_idx
  on public.transfer_logs(league_id, changed_at desc);

alter table public.transfer_logs enable row level security;
revoke all on public.transfer_logs from anon, authenticated;

create or replace function public.log_entry_transfer_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed_slots jsonb;
  v_changed_count int;
  v_old_used int := coalesce(OLD.transfers_used, 0);
  v_new_used int := coalesce(NEW.transfers_used, 0);
  v_event_type text;
begin
  if NEW.xi_json is not distinct from OLD.xi_json
     and NEW.transfers_used is not distinct from OLD.transfers_used then
    return NEW;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'slot', coalesce(
            case when (n.player->>'slot') ~ '^[0-9]+$' then (n.player->>'slot')::int end,
            case when (o.player->>'slot') ~ '^[0-9]+$' then (o.player->>'slot')::int end,
            n.ord - 1,
            o.ord - 1
          ),
          'old_name', o.player->>'name',
          'old_nation', o.player->>'nation',
          'old_role', o.player->>'role',
          'old_wild', coalesce((o.player->>'wild')::boolean, false),
          'new_name', n.player->>'name',
          'new_nation', n.player->>'nation',
          'new_role', n.player->>'role',
          'new_wild', coalesce((n.player->>'wild')::boolean, false)
        )
        order by coalesce(n.ord, o.ord)
      ),
      '[]'::jsonb
    ),
    count(*)::int
  into v_changed_slots, v_changed_count
  from jsonb_array_elements(coalesce(OLD.xi_json, '[]'::jsonb)) with ordinality as o(player, ord)
  full join jsonb_array_elements(coalesce(NEW.xi_json, '[]'::jsonb)) with ordinality as n(player, ord)
    using (ord)
  where o.player is distinct from n.player;

  v_event_type := case
    when v_new_used > v_old_used then 'bundled_transfers'
    when v_changed_count > 0 then 'wildcard_swap'
    else 'metadata_update'
  end;

  insert into public.transfer_logs (
    entry_id,
    league_id,
    user_id,
    team_name,
    actor_user_id,
    actor_role,
    event_type,
    transfer_delta,
    old_transfers_used,
    new_transfers_used,
    changed_slots,
    old_xi_json,
    new_xi_json
  )
  values (
    NEW.id,
    NEW.league_id,
    NEW.user_id,
    NEW.team_name,
    auth.uid(),
    nullif(current_setting('request.jwt.claim.role', true), ''),
    v_event_type,
    v_new_used - v_old_used,
    v_old_used,
    v_new_used,
    v_changed_slots,
    coalesce(OLD.xi_json, '[]'::jsonb),
    coalesce(NEW.xi_json, '[]'::jsonb)
  );

  return NEW;
end;
$$;

drop trigger if exists log_entry_transfer_update_trg on public.entries;
create trigger log_entry_transfer_update_trg
  after update on public.entries
  for each row execute function public.log_entry_transfer_update();

select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.entries'::regclass
  and tgname = 'log_entry_transfer_update_trg';
