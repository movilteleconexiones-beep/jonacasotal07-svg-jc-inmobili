/** Shared by the Edge entrypoint and Node regression tests. No secrets reach Vite. */
export type BillingEnvironment = 'sandbox' | 'production';
export interface BillingConfig {
  environment: BillingEnvironment;
  eventsSecret: string;
  integritySecret: string;
  publicKey: string;
  appUrl: string;
  allowedOrigins: string[];
}
export interface BillingDependencies {
  getUser(token: string): Promise<string | null>;
  createOrder(token: string, args: Record<string, unknown>): Promise<{ data: any; error: unknown }>;
  processEvent(args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  fetchTransaction(id: string, environment: BillingEnvironment): Promise<unknown>;
}

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
function equalHash(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  let mismatch = 0;
  for (let i = 0; i < 64; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
export async function authenticEvent(body: unknown, config: BillingConfig, header: string | null): Promise<boolean> {
  if (!config.eventsSecret || !record(body) || body.event !== 'transaction.updated'
    || body.environment !== (config.environment === 'sandbox' ? 'test' : 'prod')
    || !record(body.data) || !record(body.signature) || !Array.isArray(body.signature.properties)
    || body.signature.properties.length < 1 || body.signature.properties.length > 20
    || !Number.isSafeInteger(body.timestamp) || typeof body.signature.checksum !== 'string') return false;
  const values: string[] = [];
  for (const path of body.signature.properties) {
    if (typeof path !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path)) return false;
    let current: unknown = body.data;
    for (const part of path.split('.')) {
      if (!record(current) || !Object.hasOwn(current, part)) return false;
      current = current[part];
    }
    if (typeof current !== 'string' && typeof current !== 'boolean'
      && !(typeof current === 'number' && Number.isFinite(current))) return false;
    values.push(String(current));
  }
  const checksum = body.signature.checksum.toLowerCase();
  return (!header || equalHash(header.toLowerCase(), checksum))
    && equalHash(await sha256(values.join('') + body.timestamp + config.eventsSecret), checksum);
}
function transaction(value: unknown) {
  if (!record(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.id)
    || typeof value.reference !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value.reference)
    || !Number.isSafeInteger(value.amount_in_cents) || value.amount_in_cents <= 0 || value.currency !== 'COP'
    || !['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'].includes(value.status)) return null;
  return { id: value.id, reference: value.reference, amount: value.amount_in_cents, currency: value.currency, status: value.status };
}
async function boundedBody(req: Request): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 65536) { await reader.cancel(); throw new Error('payload_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export function createBillingHandler(config: BillingConfig, deps: BillingDependencies) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const allowedOrigin = origin && config.allowedOrigins.includes(origin);
    const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Vary': 'Origin', ...(allowedOrigin ? { 'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
          'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {}) },
    });
    if (req.method === 'OPTIONS') return response(allowedOrigin ? 200 : 403, {});
    if (req.method !== 'POST') return response(405, { error: 'method_not_allowed' });
    const webhook = new URL(req.url).pathname.endsWith('/events');
    if (!webhook && origin && !allowedOrigin) return response(403, { error: 'origin_not_allowed' });
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      return response(415, { error: 'unsupported_media_type' });
    let raw: string;
    let body: unknown;
    try { raw = await boundedBody(req); body = JSON.parse(raw); }
    catch (error) { return response(error instanceof Error && error.message === 'payload_too_large' ? 413 : 400, { error: 'invalid_payload' }); }
    try {
      if (webhook) {
        if (!config.eventsSecret) return response(503, { error: 'payments_not_configured' });
        if (!await authenticEvent(body, config, req.headers.get('x-event-checksum')))
          return response(401, { error: 'invalid_signature' });
        const tx = transaction((body as any).data.transaction);
        if (!tx) return response(400, { error: 'invalid_transaction' });
        if (tx.status === 'PENDING') return response(200, { result: 'pending' });
        // Reference and currency are not necessarily signed; reconcile ALL fields.
        const api = await deps.fetchTransaction(tx.id, config.environment);
        const verified = transaction(record(api) ? api.data : null);
        if (!verified || JSON.stringify(verified) !== JSON.stringify(tx))
          return response(409, { error: 'transaction_mismatch' });
        const eventId = await sha256(JSON.stringify([config.environment, tx.id, tx.reference, tx.amount, tx.currency, tx.status]));
        const { data, error } = await deps.processEvent({ p_reference: verified.reference,
          p_transaction_id: verified.id, p_amount_in_cents: verified.amount, p_currency: verified.currency,
          p_status: verified.status, p_environment: config.environment, p_event_id: eventId,
          p_payload_sha256: await sha256(raw) });
        if (error) return response(503, { error: 'processing_unavailable' });
        return response(data === 'processed' || data === 'duplicate' ? 200 : data === 'not_found' ? 404 : 409,
          { result: typeof data === 'string' ? data : 'processing_unavailable' });
      }
      const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token || !await deps.getUser(token)) return response(401, { error: 'authentication_required' });
      const prefix = config.environment === 'sandbox' ? 'pub_test_' : 'pub_prod_';
      if (!config.integritySecret || !config.publicKey.startsWith(prefix) || !config.eventsSecret)
        return response(503, { error: 'payments_not_configured' });
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!record(body) || !uuid.test(body.organizationId) || !uuid.test(body.planId) || !uuid.test(body.requestKey))
        return response(400, { error: 'invalid_checkout_request' });
      const { data: order, error } = await deps.createOrder(token, { target_org: body.organizationId,
        target_plan: body.planId, target_environment: config.environment, request_key: body.requestKey });
      if (error || !record(order)) return response(409, { error: 'checkout_unavailable' });
      if (order.status !== 'PENDING') return response(200, { orderId: order.id, status: order.status });
      const expirationMillis = Date.parse(order.expires_at);
      if (!Number.isFinite(expirationMillis) || expirationMillis <= Date.now())
        return response(409, { error: 'order_expired' });
      // Wompi's documented expiration-time example uses whole UTC seconds
      // (.000Z). Sign and send this EXACT normalized value. Postgres timestamp
      // values may include microseconds; never let date parser round-trip drift
      // alter the string Wompi sees.
      const expiration = new Date(Math.floor(expirationMillis / 1000) * 1000).toISOString();
      const signature = await sha256(order.reference + order.amount_in_cents + order.currency + expiration + config.integritySecret);
      const checkout = new URL('https://checkout.wompi.co/p/');
      checkout.search = new URLSearchParams({ 'public-key': config.publicKey, 'currency': order.currency,
        'amount-in-cents': String(order.amount_in_cents), 'reference': order.reference,
        'signature:integrity': signature, 'expiration-time': expiration,
        'redirect-url': new URL('/?billing=return', config.appUrl).toString() }).toString();
      return response(200, { orderId: order.id, reference: order.reference, checkoutUrl: checkout.toString(), environment: config.environment });
    } catch { return response(503, { error: 'processing_unavailable' }); }
  };
}
