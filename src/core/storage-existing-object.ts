/** Recognize a Storage path collision, not an auth or network failure.
 * Supabase Storage may report its current error code or a legacy HTTP 409.
 * Never infer a previously completed upload from a generic error message.
 */
export function isExistingStorageObjectError(error: {
  error?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
} | null | undefined): boolean {
  if (!error) return false;
  const code = typeof error.code === 'string' ? error.code : error.error;
  const knownCodes = ['ResourceAlreadyExists', 'KeyAlreadyExists', 'already_exists'];
  return knownCodes.includes(String(code ?? '')) ||
    error.status === 409 || error.statusCode === '409' || error.statusCode === 409;
}
