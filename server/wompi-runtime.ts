import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { createSupabasePaymentStore } from './supabase-payment-store.js';
import { createWompiWebhookRouter } from './wompi-express-router.js';

/**
 * Private Node runtime only. Never import into the Vite app.
 * Deploy only after SQL migrations 0026, 0027, 0028 pass staging review.
 */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

export function startWompiServer() {
  const environment = required('WOMPI_ENV');
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('WOMPI_ENV must be sandbox or production');
  }
  const supabaseUrl = required('SUPABASE_URL');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl)) {
    throw new Error('SUPABASE_URL must be an HTTPS Supabase project URL');
  }
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const eventsSecret = required('WOMPI_EVENTS_SECRET');
  const port = Number(process.env.PORT ?? '8080');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.use(createWompiWebhookRouter({
    eventsSecret,
    environment,
    store: createSupabasePaymentStore(client),
  }));
  const server = app.listen(port, '0.0.0.0');
  return server;
}

if (process.env.JCO_START_WOMPI_SERVER === '1') {
  startWompiServer();
}
