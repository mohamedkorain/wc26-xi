-- ⚠️  DESTRUCTIVE: wipes ALL auth users except the one whose email matches.
-- Cascades will also delete their profile rows, entries, and league memberships.
-- Edit the KEEP_EMAIL value below to match the account you want to preserve,
-- then run in SQL Editor.

-- Step 1 (preview): see what's about to be deleted
select email, created_at, last_sign_in_at
from auth.users
order by created_at;

-- Step 2 (the actual wipe — uncomment after confirming step 1 looks right)
-- delete from auth.users
-- where email != 'muhammedkorain@gmail.com';   -- ← KEEP this email
--                                              --   (case-insensitive in Supabase auth)
