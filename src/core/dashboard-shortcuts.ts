import { PERMISSIONS as P } from './permissions';

// Single source of truth for the five dashboard metrics and their operational destinations.
export const DASHBOARD_SHORTCUTS = [
  { label: 'Propiedades', metric: 'properties', target: 'PROPERTIES', permission: P.PROPERTIES_VIEW },
  { label: 'Clientes', metric: 'contacts', target: 'CONTACTS', permission: P.CLIENTS_VIEW },
  { label: 'Leads', metric: 'leads', target: 'LEADS', permission: P.LEADS_VIEW },
  { label: 'Citas y visitas', metric: 'appointments', target: 'APPOINTMENTS', permission: P.APPOINTMENTS_VIEW },
  { label: 'Negocios', metric: 'deals', target: 'DEALS', permission: P.DEALS_VIEW },
] as const;

export function permittedDashboardShortcuts(can: (permission: string) => boolean) {
  return DASHBOARD_SHORTCUTS.filter(shortcut => can(shortcut.permission));
}
