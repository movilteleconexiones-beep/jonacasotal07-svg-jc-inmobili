import { etiquetaES } from './etiquetas-es';
export interface OrganizationSummary {
  organization_id: string; organization_name: string; organization_slug: string;
  organization_status: string; access_status: string; created_at: string; registration_month: string;
  is_test: boolean; member_count: number; property_count: number;
  subscription_status: string | null; billing_mode: string | null; plan_name: string | null;
  access_until: string | null; owner_user_id: string | null;
}
export interface MonthlyOrganizations {
  month: string; registered: number; accumulated: number; active_now: number; inactive_now: number;
  pending_now: number; suspended_now: number; expired_now: number; tests: number;
}
export interface PlatformOverview {
  timezone: string; generated_at: string; organizations: OrganizationSummary[];
  totals: { total: number; active: number; inactive: number; pending: number; suspended: number; expired: number; tests: number };
  monthly: MonthlyOrganizations[];
}
export function parsePlatformOverview(data: unknown): PlatformOverview {
  if (!data || typeof data !== 'object') throw new Error('Resumen administrativo inválido.');
  const value = data as PlatformOverview;
  const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (value.timezone !== 'America/Bogota' || !value.totals || !Array.isArray(value.organizations)
    || !Array.isArray(value.monthly) || !['total','active','inactive','pending','suspended','expired','tests'].every(key => count(value.totals[key as keyof PlatformOverview['totals']]))
    || !value.organizations.every(o => o && ['organization_id','organization_name','organization_slug','access_status','registration_month','created_at'].every(key => typeof o[key as keyof OrganizationSummary] === 'string') && typeof o.is_test === 'boolean' && count(o.member_count) && count(o.property_count))
    || !value.monthly.every(m => m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m.month)
      && [m.registered,m.accumulated,m.active_now,m.inactive_now,m.pending_now,m.suspended_now,m.expired_now,m.tests].every(count))) {
    throw new Error('Resumen administrativo inválido.');
  }
  return value;
}
export const organizationStatusLabel = (status: string) => ({ ACTIVE: 'Activa', INACTIVE: 'Pendiente de pago', TRIAL: 'Pendiente (legado)', SUSPENDED: 'Suspendida', EXPIRED: 'Vencida' }[status] ?? etiquetaES(status));
export const monthLabel = (month: string) => new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
