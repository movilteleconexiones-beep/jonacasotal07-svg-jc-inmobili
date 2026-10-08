import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://nqzopzhmhqdssgpljypu.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_lN15pcBT6oZL9ubrex7UTw_loqDUZ4o';

// Explicit environment configuration takes priority so isolated test deployments
// never silently send data to the default production Supabase project.
const configuredUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const configuredKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
// Both overrides must be provided together, or neither. A partial override
// must fail closed instead of silently connecting to the default project.
export const isSupabaseConfigured = Boolean(configuredUrl) === Boolean(configuredKey);
const supabaseUrl = isSupabaseConfigured
  ? (configuredUrl || DEFAULT_SUPABASE_URL)
  : 'https://unconfigured.invalid';
const supabasePublishableKey = isSupabaseConfigured
  ? (configuredKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY)
  : 'missing-paired-supabase-configuration';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
