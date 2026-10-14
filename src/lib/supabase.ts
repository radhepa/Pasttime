import { createClient } from '@supabase/supabase-js';

/*
 * Your account and cloud copy live in your own Supabase project (shared with FitPip, in a separate
 * private table: every row is readable only by the account that wrote it).
 * The publishable key is meant to ship in the browser; row-level security does the protecting.
 */
const URL = import.meta.env.VITE_SUPABASE_URL || 'https://jvescwzjijbjcfuxdqxo.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_0m38u1OjuLxTmF9O_gVNng_SDx2Y2eJ';

export const supabase = createClient(URL, KEY, {
  auth: {
    storageKey: 'pastime.auth',
    persistSession: true,
    autoRefreshToken: true,
    // Password sign-in only, and the app uses #/routes, so never read tokens from the URL.
    detectSessionInUrl: false,
  },
});
