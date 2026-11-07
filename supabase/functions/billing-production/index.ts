/**
 * G12 — isolated Wompi LIVE gateway.
 * Checkout never falls back to Sandbox and never exposes keys to the browser.
 * The original /billing gateway stays exclusively for the test tenant.
 * Wompi production merchant webhooks belong at:
 *   https://cuitgyqrjibgwuniapmk.supabase.co/functions/v1/billing-production/events
 */
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createBillingHandler } from '../_shared/billing-handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const publishable = Deno.env.get('SUPABASE_ANON_KEY')!;
const privileged = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Never use WOMPI_ENV or the Sandbox credentials in this deployment.
// Each key must be from the SAME production merchant account.
const privateKey = Deno.env.get('WOMPI_PROD_PRIVATE_KEY') ?? '';
const publicKey = Deno.env.get('WOMPI_PROD_PUBLIC_KEY') ?? '';
const eventsSecret = Deno.env.get('WOMPI_PROD_EVENTS_SECRET') ?? '';
const integritySecret = Deno.env.get('WOMPI_PROD_INTEGRITY_SECRET') ?? '';

// Fail CLOSED before even offering a checkout if any credential is missing.
// Otherwise a user could pay but the gateway could not confirm the payment.
const merchantConfigured =
  privateKey.startsWith('prv_prod_') &&
  publicKey.startsWith('pub_prod_') &&
  eventsSecret.startsWith('prod_events_') &&
  integritySecret.startsWith('prod_integrity_');

const config = {
  environment: 'production' as const,
  eventsSecret: merchantConfigured ? eventsSecret : '',
  integritySecret: merchantConfigured ? integritySecret : '',
  publicKey: merchantConfigured ? publicKey : '',
  appUrl: 'https://www.inmojco.com/',
  allowedOrigins: ['https://www.inmojco.com', 'https://inmojco.com'],
};

Deno.serve(createBillingHandler(config, {
  async getUser(token) {
    const { data, error } = await privileged.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  async createOrder(token, args) {
    // User-signed RPC enforces production_enabled AND !is_test server side.
    // A modified frontend cannot send a test organization through LIVE.
    const client = createClient(url, publishable, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return await client.rpc('billing_create_order', args);
  },
  async processEvent(args) {
    return await privileged.rpc('process_verified_payment_event', args);
  },
  async fetchTransaction(id, environment) {
    if (!merchantConfigured || environment !== 'production') {
      throw new Error('Production merchant is not configured');
    }
    const res = await fetch(
      `https://production.wompi.co/v1/transactions/${encodeURIComponent(id)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${privateKey}`,
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) throw new Error('Wompi verification unavailable');
    return await res.json();
  },
}));
