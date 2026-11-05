import type { PropertyConsignmentInput } from './property-consignment';

/** A per-tab retry record. Never persist contact details or the submitted payload. */
export interface ConsignmentAttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PendingAttempt {
  fingerprint: string;
  requestId: string;
}

const prefix = 'inmojco:consignment-attempt:';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fingerprintPattern = /^[0-9a-f]{64}$/;

function browserStorage(): ConsignmentAttemptStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; }
  catch { return null; }
}

function storageKey(slug: string): string {
  return prefix + encodeURIComponent(slug);
}

function validAttempt(value: unknown): value is PendingAttempt {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PendingAttempt>;
  return typeof record.fingerprint === 'string' &&
    fingerprintPattern.test(record.fingerprint) &&
    typeof record.requestId === 'string' && uuidPattern.test(record.requestId);
}

async function payloadFingerprint(siteSlug: string, input: PropertyConsignmentInput): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([siteSlug, input]));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fresh manager instances model a browser reload; in-memory fallback also
 * works when sessionStorage is blocked or browser privacy mode rejects writes.
 */
export function createConsignmentAttemptManager() {
  const pending = new Map<string, PendingAttempt>();
  const completedIds = new Map<string, string>();
  const unreliableKeys = new Set<string>();

  function readStored(key: string, storage: ConsignmentAttemptStorage | null): PendingAttempt | null {
    if (!storage || unreliableKeys.has(key)) return null;
    try {
      const raw = storage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return validAttempt(parsed) ? parsed : null;
    } catch { return null; }
  }

  async function getRequestId(
    siteSlug: string,
    input: PropertyConsignmentInput,
    storage: ConsignmentAttemptStorage | null = browserStorage(),
  ): Promise<string> {
    const key = storageKey(siteSlug);
    const fingerprint = await payloadFingerprint(siteSlug, input);
    let candidate = pending.get(key) ?? null;
    const saved = readStored(key, storage);
    // Never revive a stale value after a failed write or a completed request.
    if (saved && saved.requestId !== completedIds.get(key) &&
        (!candidate || candidate.fingerprint === saved.fingerprint)) {
      candidate = saved;
    }
    if (candidate?.fingerprint === fingerprint) {
      pending.set(key, candidate);
      return candidate.requestId;
    }
    const attempt = { fingerprint, requestId: globalThis.crypto.randomUUID() };
    pending.set(key, attempt);
    if (storage) {
      try {
        storage.setItem(key, JSON.stringify(attempt));
        unreliableKeys.delete(key);
        completedIds.delete(key);
      } catch { unreliableKeys.add(key); }
    }
    return attempt.requestId;
  }

  /** Only clear after explicit reset/closure, never on an uncertain response. */
  function clear(
    siteSlug: string,
    storage: ConsignmentAttemptStorage | null = browserStorage(),
  ): void {
    const key = storageKey(siteSlug);
    const last = pending.get(key) ?? readStored(key, storage);
    if (last) completedIds.set(key, last.requestId);
    pending.delete(key);
    if (storage) {
      try {
        storage.removeItem(key);
        unreliableKeys.delete(key);
      } catch { unreliableKeys.add(key); }
    }
  }

  return { getRequestId, clear };
}

const attempts = createConsignmentAttemptManager();
export const getConsignmentRequestId = attempts.getRequestId;
export const clearConsignmentAttempt = attempts.clear;
