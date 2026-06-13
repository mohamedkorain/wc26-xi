-- Track which matches have been scored so score-day can short-circuit
-- on idle runs instead of re-processing finished matches every invocation.

alter table public.matches
  add column if not exists scored_at timestamptz;
