import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://cuitgyqrjibgwuniapmk.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_U-fFWqorKw1GTp9hgMZDyQ_x4Iqj6cr';

// Explicit environment configuration takes priority so isolated test deployments
// never silently send data to the default production Supabase project.
const configuredUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const configuredKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
const supabaseUrl = configuredUrl || DEFAULT_SUPABASE_URL;
const supabasePublishableKey = configuredKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

// Both overrides must be provided together, or neither. A partial override
// could otherwise mix credentials from two separate Supabase projects.
export const isSupabaseConfigured = Boolean(configuredUrl) === Boolean(configuredKey);

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
