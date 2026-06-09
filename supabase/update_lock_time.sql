-- Move the HALLO AMRIKA submission deadline to coincide with the
-- WC26 opening whistle: 22:00 Cairo = 19:00 UTC on 11 June 2026.
update public.leagues
set locked_at = '2026-06-11 19:00:00+00'   -- 19:00 UTC = 22:00 Cairo (kickoff)
where id = '11111111-1111-1111-1111-111111111111';
