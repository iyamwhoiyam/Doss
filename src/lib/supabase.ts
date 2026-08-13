import { createClient } from '@supabase/supabase-js';

/* Config resolution:
   1. Runtime injection (self-hosted Docker): the web container writes
      /env.js at start, which sets window.__SHOPARE_ENV__.
   2. Build-time env (local dev): VITE_* vars from .env. */
declare global {
  interface Window {
    __SHOPARE_ENV__?: { SUPABASE_URL?: string; SUPABASE_KEY?: string };
  }
}

const runtime = typeof window !== 'undefined' ? window.__SHOPARE_ENV__ : undefined;
const url = runtime?.SUPABASE_URL || (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const key =
  runtime?.SUPABASE_KEY || (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);

if (!url || !key) {
  // Fail loudly at boot rather than mysteriously on first query.
  throw new Error(
    'Missing Supabase config. Self-hosted: the web container must set ANON_KEY. ' +
      'Local dev: copy .env.example to .env.',
  );
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
