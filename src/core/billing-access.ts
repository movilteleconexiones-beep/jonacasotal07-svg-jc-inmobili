export interface BillingAccess {
  requires_payment: boolean;
  is_test: boolean;
  operational: boolean;
  status: string;
  can_manage_billing: boolean;
  terms_accepted: boolean;
  permissions: string[];
  period_end: string | null;
  subscription_status: string | null;
}

/** UI permissions come from the same database checks that authorize writes. */
export function parseBillingAccess(value: unknown): BillingAccess {
  if (!value || typeof value !== 'object') throw new Error('No se pudo verificar la activación.');
  const data = value as Record<string, unknown>;
  if (typeof data.operational !== 'boolean' || typeof data.requires_payment !== 'boolean'
    || typeof data.can_manage_billing !== 'boolean' || !Array.isArray(data.permissions)
    || !data.permissions.every(item => typeof item === 'string')) {
    throw new Error('Respuesta de activación inválida.');
  }
  return data as unknown as BillingAccess;
}
