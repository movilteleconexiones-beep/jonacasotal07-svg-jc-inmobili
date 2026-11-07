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

/**
 * #254: Lifetime is a separate SuperAdmin-only action. The backend RPC
 * validates the designated platform owner, active owner acceptance, capacity,
 * and immutable audit. This does NOT enable the customer eight-day trial.
 */
export const manualLifetimeAdminEnabled = true;
