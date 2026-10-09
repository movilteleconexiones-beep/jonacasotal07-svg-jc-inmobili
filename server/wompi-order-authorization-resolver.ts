import { buildAuthorizedSandboxOrderDraft, type SandboxOrderAuthorization } from './wompi-authorized-order-draft.js';
import type { CreateSandboxOrderInput, TrustedSandboxOrderDraft } from './wompi-order-draft.js';

/** Implement with a trusted, server-side DB/RPC lookup bound to the verified user. */
export interface TrustedBillingAuthorizationResolver {
  resolve(input: { userId: string; organizationId: string }): Promise<SandboxOrderAuthorization>;
}

/**
 * Server-only orchestration. userId MUST come from a verified auth session,
 * never request JSON. Resolver must check active tenant membership and billing
 * permission against the database. Repeat these checks transactionally on INSERT.
 * Does not persist an order or expose a checkout URL.
 */
export async function prepareAuthorizedSandboxOrderDraft(
  input: CreateSandboxOrderInput,
  verifiedUserId: string,
  resolver: TrustedBillingAuthorizationResolver,
): Promise<TrustedSandboxOrderDraft> {
  if (typeof verifiedUserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(verifiedUserId)) {
    throw new Error('Verified user required');
  }
  const authorization = await resolver.resolve({ userId: verifiedUserId, organizationId: input.organizationId });
  return buildAuthorizedSandboxOrderDraft(input, authorization);
}
