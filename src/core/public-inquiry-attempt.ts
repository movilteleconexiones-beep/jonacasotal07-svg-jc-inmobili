/** Preserve an inquiry's UUID across retries and refreshes without storing its personal fields.
 *  This module is inert unless VITE_PUBLIC_CRM_IDEMPOTENT=true and the server
 *  has been migrated to submit_public_website_lead_once(..., p_request_id).
 */
export interface PublicWebsiteInquiry {
  p_slug: string;
  p_name: string;
  p_email: string;
  p_phone: string;
  p_service: string;
  p_message: string;
  p_consent: boolean;
  p_trap: string;
}

export interface AttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Attempt { fingerprint: string; requestId: string }

const attempts = new Map<string, Attempt>();
// A confirmed submission must not be resurrected if sessionStorage removal fails.
const completedRequestIds = new Map<string, string>();
const prefix = 'inmojco:public-crm-attempt:';

function attemptKey(slug: string) {
  return prefix + encodeURIComponent(slug);
}

function browserStorage(): AttemptStorage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; }
  catch { return null; }
}

function isAttempt(value: unknown): value is Attempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Partial<Attempt>;
  return typeof attempt.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(attempt.fingerprint) &&
    typeof attempt.requestId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt.requestId);
}

function canonicalForm(inquiry: PublicWebsiteInquiry) {
  return JSON.stringify([
    inquiry.p_slug,
    inquiry.p_name.trim(),
    inquiry.p_email.trim().toLowerCase(),
    inquiry.p_phone.trim(),
    inquiry.p_service.trim(),
    inquiry.p_message.trim(),
    inquiry.p_consent,
    inquiry.p_trap,
  ]);
}

/** The UUID survives network errors; changed details start a new logical inquiry.
 *  A separate completed inquiry calls clearPublicInquiryAttempt().
 */
export async function getPublicInquiryRequestId(
  inquiry: PublicWebsiteInquiry,
  storage: AttemptStorage | null = browserStorage(),
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalForm(inquiry));
  const fingerprintBytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const fingerprint = Array.from(fingerprintBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const key = attemptKey(inquiry.p_slug);
  let cached = attempts.get(key);
  if (storage) {
    try {
      const saved = storage.getItem(key);
      const parsed: unknown = saved ? JSON.parse(saved) : null;
      // A stale sessionStorage value must not override a newer in-memory attempt
      // when a previous storage write was rejected (privacy mode/quota).
      if (isAttempt(parsed) && parsed.requestId !== completedRequestIds.get(key) &&
          (!cached || cached.fingerprint === parsed.fingerprint)) cached = parsed;
    } catch {
      // Browsers may deny session storage. In-memory fallback still prevents
      // accidental retries in the current page.
    }
  }
  if (cached?.fingerprint === fingerprint) {
    attempts.set(key, cached);
    return cached.requestId;
  }
  const attempt = { fingerprint, requestId: globalThis.crypto.randomUUID() };
  attempts.set(key, attempt);
  if (storage) {
    try {
      storage.setItem(key, JSON.stringify(attempt));
      completedRequestIds.delete(key);
    }
    catch { /* Protected storage may be disabled; in-memory fallback is enough for this tab. */ }
  }
  return attempt.requestId;
}

/** Call only once the server confirmed success, not when a request timed out. */
export function clearPublicInquiryAttempt(slug: string, storage: AttemptStorage | null = browserStorage()) {
  const key = attemptKey(slug);
  const completed = attempts.get(key);
  if (completed) completedRequestIds.set(key, completed.requestId);
  attempts.delete(key);
  if (storage) {
    try { storage.removeItem(key); } catch { /* Storage may be disabled. */ }
  }
}
