import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://cuitgyqrjibgwuniapmk.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_U-fFWqorKw1GTp9hgMZDyQ_x4Iqj6cr';

// Avoid silently connecting to an unrelated project via stale local/deploy variables.
const configuredUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const configuredKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
const supabaseUrl = DEFAULT_SUPABASE_URL;
const supabasePublishableKey = DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured =
  (!configuredUrl || configuredUrl === DEFAULT_SUPABASE_URL) &&
  (!configuredKey || configuredKey === DEFAULT_SUPABASE_PUBLISHABLE_KEY);

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
