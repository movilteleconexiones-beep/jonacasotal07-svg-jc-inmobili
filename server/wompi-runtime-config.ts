/**
 * Server-side only. No secrets or privileged credentials are ever returned in
 * diagnostics. This validation runs BEFORE creating the Supabase client or
 * opening a port, so invalid Railway settings cannot receive payment events.
 */
export const INMOJCO_PRODUCTION_SUPABASE_URL = 'https://cuitgyqrjibgwuniapmk.supabase.co';

type RuntimeEnvironment = Record<string, string | undefined>;

function requireEnvironmentVariable(env: RuntimeEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

function requireRealSecret(env: RuntimeEnvironment, name: string): string {
  const value = requireEnvironmentVariable(env, name);
  // Reject copy-pasted setup examples without displaying their contents.
  if (value.length < 16 ||
      /^(?:replace[-_ ]?me|change[-_ ]?me|placeholder|example|demo|undefined|null|todo|your[-_ ]?(?:key|secret))$/i.test(value)) {
    throw new Error(`Invalid required server secret: ${name}`);
  }
  return value;
}

export function validateWompiRuntimeConfig(
  env: RuntimeEnvironment = process.env,
): {
  environment: 'sandbox' | 'production';
  supabaseUrl: string;
  serviceRoleKey: string;
  eventsSecret: string;
  port: number;
} {
  const environment = requireEnvironmentVariable(env, 'WOMPI_ENV');
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('WOMPI_ENV must be sandbox or production');
  }

  if (environment === 'production' && env.WOMPI_PRODUCTION_APPROVED !== '1') {
    throw new Error('Production Wompi requires WOMPI_PRODUCTION_APPROVED=1 after payment certification');
  }

  const supabaseUrl = requireEnvironmentVariable(env, 'SUPABASE_URL');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl)) {
    throw new Error('SUPABASE_URL must be an HTTPS Supabase project URL');
  }
  // The owner has two Supabase projects. Real subscription payments must NEVER
  // land in the legacy, unrelated database even if keys there are valid.
  if (environment === 'production' &&
      supabaseUrl.replace(/\/$/, '') !== INMOJCO_PRODUCTION_SUPABASE_URL) {
    throw new Error('Production Wompi requires the official INMOJCO Supabase project');
  }

  const serviceRoleKey = requireRealSecret(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const eventsSecret = requireRealSecret(env, 'WOMPI_EVENTS_SECRET');
  if (serviceRoleKey === eventsSecret) {
    throw new Error('WOMPI_EVENTS_SECRET and SUPABASE_SERVICE_ROLE_KEY must be different');
  }

  const port = Number(env.PORT ?? '8080');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }

  return {
    environment,
    supabaseUrl,
    serviceRoleKey,
    eventsSecret,
    port,
  };
}
