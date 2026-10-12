import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createBillingHandler } from '../_shared/billing-handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const publishable = Deno.env.get('SUPABASE_ANON_KEY')!;
const privileged = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Live charging is an explicit server deployment choice; never inferred from a browser flag.
const environment = Deno.env.get('WOMPI_ENV') === 'production' ? 'production' : 'sandbox';
const config = {
  environment,
  eventsSecret: Deno.env.get('WOMPI_EVENTS_SECRET') ?? '',
  integritySecret: Deno.env.get('WOMPI_INTEGRITY_SECRET') ?? '',
  publicKey: Deno.env.get('WOMPI_PUBLIC_KEY') ?? '',
  appUrl: Deno.env.get('APP_URL') ?? 'https://app.inmojco.com/',
  allowedOrigins: ['https://app.inmojco.com', 'https://www.inmojco.com', 'https://inmojco.com',
    'https://jonacasotal07-svg-jc-inmobili-production.up.railway.app'],
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
    const res = await fetch(`https://${host}/v1/transactions/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('Wompi unavailable');
    return await res.json();
  },
}));
