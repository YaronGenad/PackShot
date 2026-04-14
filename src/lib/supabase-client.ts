/**
 * Supabase client for frontend — uses anon key (public, safe for browser).
 * Auth state is managed via cookies set by the server.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const msg =
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set at build time. ' +
    'When deploying to Fly.io, pass them via `fly deploy --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=...`.';
  if (import.meta.env.PROD) {
    throw new Error(msg);
  }
  console.warn('[supabase-client] ' + msg);
}

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  },
);
