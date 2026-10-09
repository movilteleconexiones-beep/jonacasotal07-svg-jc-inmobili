import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Server-only verification for Wompi Colombia payment event checksums.
 * Never import this file into the Vite frontend or expose the events secret.
 */
export interface WompiEvent {
  event: string;
  environment: 'test' | 'prod';
  data: Record<string, unknown>;
  signature: { properties: string[]; checksum: string };
  timestamp: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function propertyValue(data: Record<string, unknown>, path: string): string | null {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(path)) return null;
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return null;
    current = current[segment];
  }
  if (typeof current === 'string' || typeof current === 'boolean') return String(current);
  if (typeof current === 'number' && Number.isFinite(current)) return String(current);
  return null;
}

export function verifyWompiEvent(
  payload: unknown,
  secret: string,
  expectedEnvironment: 'test' | 'prod',
  headerChecksum?: string,
): payload is WompiEvent {
  if (!secret || !isRecord(payload) || payload.event !== 'transaction.updated'
    || payload.environment !== expectedEnvironment || !isRecord(payload.data)
    || !isRecord(payload.signature) || !Array.isArray(payload.signature.properties)
    || payload.signature.properties.length === 0 || payload.signature.properties.length > 20
    || !Number.isSafeInteger(payload.timestamp) || typeof payload.signature.checksum !== 'string') return false;

  const properties = payload.signature.properties;
  if (!properties.every((property: unknown) => typeof property === 'string')) return false;
  const values = properties.map((property: string) => propertyValue(payload.data as Record<string, unknown>, property));
  if (values.some((value: string | null) => value === null)) return false;

  const checksum = payload.signature.checksum.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum)) return false;
  if (headerChecksum && headerChecksum.toLowerCase() !== checksum) return false;

  const calculated = createHash('sha256').update(values.join('') + payload.timestamp + secret).digest();
  return timingSafeEqual(calculated, Buffer.from(checksum, 'hex'));
}

/**
 * Call only AFTER verifyWompiEvent returns true.
 * A valid checksum is not sufficient to approve an order: the server must still
 * compare stored reference, amount, currency, provider transaction and order state.
 */
export function getVerifiedWompiTransaction(payload: WompiEvent) {
  const tx = payload.data.transaction;
  if (!isRecord(tx) || typeof tx.id !== 'string' || typeof tx.reference !== 'string'
    || !Number.isSafeInteger(tx.amount_in_cents) || typeof tx.currency !== 'string'
    || typeof tx.status !== 'string') return null;
  if (!['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'].includes(tx.status)) return null;
  return {
    id: tx.id,
    reference: tx.reference,
    amountInCents: tx.amount_in_cents as number,
    currency: tx.currency,
    status: tx.status,
  };
}
