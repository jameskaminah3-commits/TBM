import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[SUPABASE] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Supabase client disabled until env vars are configured.",
  );
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    )
  : null;

export function getSupabaseClient() {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and restart the dev server.",
    );
  }

  return supabase;
}
