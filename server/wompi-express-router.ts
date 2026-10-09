import express, { type Router } from 'express';
import { handleWompiWebhook, type PaymentStore } from './wompi-webhook-handler.js';

export interface WompiRouteConfig {
  eventsSecret: string;
  environment: 'sandbox' | 'production';
  store: PaymentStore;
}

/**
 * Server-only route factory. Mount behind HTTPS in a trusted Node process.
 * Never bundle this module into Vite, and never expose the events secret.
 */
export function createWompiWebhookRouter(config: WompiRouteConfig): Router {
  if (!config.eventsSecret || config.eventsSecret.trim().length < 16) {
    throw new Error('Wompi events secret is missing or too short');
  }
  if (config.environment !== 'sandbox' && config.environment !== 'production') {
    throw new Error('Invalid Wompi environment');
  }
  const router = express.Router();
  router.post('/wompi/events', express.json({ limit: '64kb', strict: true }), async (req, res) => {
    if (!req.is('application/json')) {
      res.status(415).json({ result: 'unsupported_media_type' });
      return;
    }
    const header = req.header('X-Event-Checksum');
    if (header && !/^[a-fA-F0-9]{64}$/.test(header)) {
      res.status(401).json({ result: 'invalid_signature' });
      return;
    }
    try {
      const result = await handleWompiWebhook(
        req.body, config.eventsSecret, config.environment, config.store, header,
      );
      res.status(result.statusCode).json({ result: result.result });
    } catch {
      // Do not leak RPC, signature, or internal error details.
      res.status(503).json({ result: 'processing_unavailable' });
    }
  });
  router.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
      res.status(413).json({ result: 'payload_too_large' });
    } else if (err instanceof SyntaxError) {
      res.status(400).json({ result: 'invalid_json' });
    } else {
      next(err);
    }
  });
  return router;
}
