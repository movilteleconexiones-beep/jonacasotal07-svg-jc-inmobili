/** Shared contact-identity comparison for the private CRM interface.
 *
 * This intentionally mirrors the normalized (tenant,email,full name) candidate
 * database index, NOT a unique-email rule. Two distinct people may share a
 * family or company inbox, and records without an email cannot be deduplicated
 * reliably with this key.
 *
 * This client check is advisory only: PostgreSQL must arbitrate concurrent
 * requests after the candidate index is approved and deployed.
 */
export interface ContactIdentity {
  first_name: string;
  last_name?: string | null;
  email?: string | null;
}

export function normalizedContactName(
  firstName: string,
  lastName?: string | null,
): string {
  return `${firstName} ${lastName ?? ''}`.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function sameContactIdentity(
  left: ContactIdentity,
  right: ContactIdentity,
): boolean {
  const leftEmail = left.email?.trim().toLowerCase();
  const rightEmail = right.email?.trim().toLowerCase();
  if (!leftEmail || !rightEmail) return false;
  const leftName = normalizedContactName(left.first_name, left.last_name);
  const rightName = normalizedContactName(right.first_name, right.last_name);
  return Boolean(leftName && rightName && leftEmail === rightEmail && leftName === rightName);
}
