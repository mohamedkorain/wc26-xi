-- Track per-date scoring progress so the Edge Function can resume from
-- where it timed out, instead of restarting at offset 0 and never reaching
-- the tail of the queue.

create table if not exists public.scoring_progress (
  match_date  date primary key,
  offset_     int not null default 0,   -- "offset" is reserved in some pg versions
  updated_at  timestamptz not null default now()
);

-- Internal table — only the Edge Function (service_role) reads/writes.
-- Enable RLS with no policies → anon + authenticated get nothing.
alter table public.scoring_progress enable row level security;
