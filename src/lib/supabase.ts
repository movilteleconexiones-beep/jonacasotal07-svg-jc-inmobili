import { createClient } from '@supabase/supabase-js';

// Never fall back to the official production project from an unconfigured build.
// Each deployment must explicitly provide its own paired public configuration.
const configuredUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const configuredKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
export const isSupabaseConfigured = Boolean(configuredUrl && configuredKey);
const supabaseUrl = isSupabaseConfigured ? configuredUrl! : 'https://unconfigured.invalid';
const supabasePublishableKey = isSupabaseConfigured ? configuredKey! : 'missing-supabase-configuration';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
