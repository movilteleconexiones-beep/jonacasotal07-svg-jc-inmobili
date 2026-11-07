/**
 * #203: launch gate for trial + perpetual entitlement actions.
 * Keep absent / false in production until the audited SQL migration,
 * signed terms, tenant isolation, rollback and E2E payment checks pass.
 *
 * Vite exposes VITE_* variables to the browser; this flag is NOT a security
 * boundary. The RPCs independently authorize roles, terms and capacity.
 */
export const trialAndLifetimeActionsEnabled =
  import.meta.env.VITE_BILLING_TRIAL_LIFETIME_ENABLED === 'true';
