import { buildSandboxOrderDraft, type CreateSandboxOrderInput, type TrustedSandboxOrderDraft } from './wompi-order-draft.js';

export interface SandboxOrderAuthorization {
  /** Trusted server-side checks; do not derive these flags from request JSON. */
  authenticated: boolean;
  organizationId: string;
  organizationActive: boolean;
  activeMember: boolean;
  canManageBilling: boolean;
}

/**
 * Fail-closed preflight only. Authorization must be obtained from trusted DB/RPC
 * and rechecked atomically with the pending order INSERT to prevent TOCTOU.
 * Never expose a checkout reference or accept payment based on this draft alone.
 */
export function buildAuthorizedSandboxOrderDraft(
  input: CreateSandboxOrderInput,
  authorization: SandboxOrderAuthorization,
): TrustedSandboxOrderDraft {
  if (!authorization.authenticated || !authorization.organizationActive
    || !authorization.activeMember || !authorization.canManageBilling
    || authorization.organizationId !== input.organizationId) {
    throw new Error('Sandbox order not authorized');
  }
  return buildSandboxOrderDraft(input);
}
