// Supabase client — anon (public) key, safe to ship in client code.
// Project: nyytjswemjrybjfmqaaq
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://nyytjswemjrybjfmqaaq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2dpkprdkF6MM9EWHrbabHw_tir1tYAZ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
