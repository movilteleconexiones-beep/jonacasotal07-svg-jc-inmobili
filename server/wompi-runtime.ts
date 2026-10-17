import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { createSupabasePaymentStore } from './supabase-payment-store.js';
import { createWompiWebhookRouter } from './wompi-express-router.js';

import { validateWompiRuntimeConfig } from './wompi-runtime-config.js';

/**
 * Private Node runtime only. Never import into the Vite app.
 * Deploy only after SQL migrations 0026, 0027, 0028 pass staging review.
 */
export function startWompiServer() {
  const {
    environment, supabaseUrl, serviceRoleKey, eventsSecret, port,
  } = validateWompiRuntimeConfig();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
  // Readiness is separate from liveness: a running process is not necessarily
  // able to persist authenticated payment events. Never return credentials.
  app.get('/readyz', async (_req, res) => {
    try {
      const { error } = await client.from('payment_orders').select('id').limit(0);
      if (error) {
        res.status(503).json({ status: 'unavailable' });
        return;
      }
      res.status(200).json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use(createWompiWebhookRouter({
    eventsSecret,
    environment,
    store: createSupabasePaymentStore({
      async rpc(name, args) {
        const { data, error } = await client.rpc(name, args);
        return { data: typeof data === 'string' ? data : null,
          error: error ? { message: error.message } : null };
      },
    }),
  }));
  const server = app.listen(port, '0.0.0.0');
  return server;
}

if (process.env.JCO_START_WOMPI_SERVER === '1') {
  startWompiServer();
}
