import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createBillingHandler } from '../_shared/billing-handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const publishable = Deno.env.get('SUPABASE_ANON_KEY')!;
const privileged = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Live charging is an explicit server deployment choice; never inferred from a browser flag.
const environment = Deno.env.get('WOMPI_ENV') === 'production' ? 'production' : 'sandbox';
// Private Wompi REST key: required for server-to-server transaction lookup.
// Wompi no longer accepts unauthenticated GET /v1/transactions/:id.
// Never expose this variable to Vite, the browser, logs or checkout responses.
const wompiPrivateKey = Deno.env.get('WOMPI_PRIVATE_KEY') ?? '';
const config = {
  environment,
  eventsSecret: Deno.env.get('WOMPI_EVENTS_SECRET') ?? '',
  integritySecret: Deno.env.get('WOMPI_INTEGRITY_SECRET') ?? '',
  publicKey: Deno.env.get('WOMPI_PUBLIC_KEY') ?? '',
  // Public checkouts and return pages are always hosted on the canonical domain.
  // Ignore obsolete app/Railway technical domains even if an old APP_URL remains set.
  appUrl: 'https://www.inmojco.com/',
  // Only the official domain (and its bare-domain redirect) may call checkout
  // from a browser. Wompi signed server callbacks do not require a CORS origin.
  allowedOrigins: ['https://www.inmojco.com', 'https://inmojco.com'],
} as const;

Deno.serve(createBillingHandler({ ...config, allowedOrigins: [...config.allowedOrigins] }, {
  async getUser(token) {
    const { data, error } = await privileged.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  async createOrder(token, args) {
    // User context ensures the RPC cannot use a service-role bypass for checkout.
    const client = createClient(url, publishable, { global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false } });
    return await client.rpc('billing_create_order', args);
  },
  async processEvent(args) { return await privileged.rpc('process_verified_payment_event', args); },
  async fetchTransaction(id, env) {
    const host = env === 'sandbox' ? 'sandbox.wompi.co' : 'production.wompi.co';
    const prefix = env === 'sandbox' ? 'prv_test_' : 'prv_prod_';
    if (!wompiPrivateKey.startsWith(prefix)) throw new Error('Wompi private key not configured for environment');
    const res = await fetch(`https://${host}/v1/transactions/${encodeURIComponent(id)}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${wompiPrivateKey}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('Wompi unavailable');
    return await res.json();
  },
}));
