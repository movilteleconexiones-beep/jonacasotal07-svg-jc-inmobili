import { PERMISSIONS as P } from './permissions';

export const TENANT_MENU = [
  { id: 'DASHBOARD', label: 'Inicio', permissions: [] },
  { id: 'PROPERTIES', label: 'Propiedades', permissions: [P.PROPERTIES_VIEW] },
  { id: 'CONTACTS', label: 'Clientes', permissions: [P.CLIENTS_VIEW] },
  { id: 'LEADS', label: 'Leads / CRM', permissions: [P.LEADS_VIEW] },
  { id: 'APPOINTMENTS', label: 'Agenda', permissions: [P.APPOINTMENTS_VIEW] },
  { id: 'DEALS', label: 'Negocios', permissions: [P.DEALS_VIEW] },
  { id: 'OWNERS', label: 'Propietarios', permissions: [P.OWNERS_VIEW] },
  { id: 'DOCUMENTS', label: 'Documentos', permissions: [P.DOCUMENTS_VIEW] },
  { id: 'COMMISSIONS', label: 'Comisiones', permissions: [P.COMMISSIONS_VIEW] },
  { id: 'REPORTS', label: 'Reportes', permissions: [P.REPORTS_VIEW] },
  { id: 'PORTAL', label: 'Mi Portal', permissions: [] },
  { id: 'USERS', label: 'Usuarios', permissions: [P.USERS_VIEW] },
  { id: 'IMPORT', label: 'Importar datos', permissions: [P.CLIENTS_CREATE, P.PROPERTIES_CREATE] },
  { id: 'SETTINGS', label: 'Configuración', permissions: [P.SETTINGS_VIEW] },
  { id: 'LICENSE', label: 'Licencia', permissions: [P.SETTINGS_VIEW] },
] as const;

export type TenantMenuId = typeof TENANT_MENU[number]['id'];

export function tenantMenu(can: (permission: string) => boolean, owner: boolean, termsRequired: boolean) {
  return TENANT_MENU.map(item => {
    const permitted = item.permissions.length === 0 || item.permissions.some(can) || (item.id === 'LICENSE' && owner);
    return { ...item, available: permitted && (!termsRequired || item.id === 'LICENSE'), visible: owner || permitted };
  }).filter(item => item.visible);
}
