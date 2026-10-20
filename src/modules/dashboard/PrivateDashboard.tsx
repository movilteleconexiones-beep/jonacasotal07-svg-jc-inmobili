import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ArrowUpRight,
  CalendarDays,
  ContactRound,
  FileSpreadsheet,
  FileText,
  Handshake,
  Home,
  LayoutDashboard,
  Palette,
  ExternalLink,
  LogOut,
  LockKeyhole,
  Settings,
  ScrollText,
  BadgeDollarSign,
  BarChart3,
  UserCircle2,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
  X,
} from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { tenantMenu } from '../../core/tenant-menu';
import { displayTenantRole, tenantAccessMode } from '../../core/portal-access-mode';
import { permittedDashboardShortcuts } from '../../core/dashboard-shortcuts';
import { supabase } from '../../lib/supabase';
import { DataImportCenter } from '../imports/DataImportCenter';
import { PropertiesModule } from '../properties/PropertiesModule';
import { PropertyConsignmentsModule } from '../consignments/PropertyConsignmentsModule';
import { ContactsModule } from '../contacts/ContactsModule';
import { RentalIntakeWizard } from '../rentals/RentalIntakeWizard';
import { LeadsModule } from '../leads/LeadsModule';
import { AppointmentsModule } from '../appointments/AppointmentsModule';
import { DealsModule } from '../deals/DealsModule';
import { SettingsModule } from '../settings/SettingsModule';
import { UsersRolesModule } from '../users/UsersRolesModule';
import { LicenseModule } from '../license/LicenseModule';
import { BillingModule } from '../billing/BillingModule';
import { OwnersModule } from '../owners/OwnersModule';
import { DocumentsModule } from '../documents/DocumentsModule';
import { CommissionsModule } from '../commissions/CommissionsModule';
import { ReportsModule } from '../reports/ReportsModule';
import { PortalHub } from '../portal/PortalHub';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { tenantPublicPath } from '../../core/public-tenant-route';
import { paletteFromLogoUrl, safeBrandUrl, safeTenantColor, TENANT_DEFAULT_PRIMARY, TENANT_DEFAULT_SECONDARY } from '../../core/tenant-palette';

type DashboardView =
  | 'DASHBOARD'
  | 'PROPERTIES'
  | 'CONSIGNMENTS'
  | 'CONTACTS'
  | 'RENTAL_INTAKE'
  | 'LEADS'
  | 'APPOINTMENTS'
  | 'DEALS'
  | 'USERS'
  | 'IMPORT'
  | 'SETTINGS'
  | 'LICENSE'
  | 'BILLING'
  | 'OWNERS'
  | 'DOCUMENTS'
  | 'COMMISSIONS'
  | 'REPORTS'
  | 'PORTAL';

interface DashboardStats {
  properties: number;
  contacts: number;
  leads: number;
  appointments: number;
  deals: number;
}

const EMPTY_STATS: DashboardStats = {
  properties: 0,
  contacts: 0,
  leads: 0,
  appointments: 0,
  deals: 0,
};

interface PrivateDashboardProps {
  onClose: () => void;
}

export function PrivateDashboard({ onClose }: PrivateDashboardProps) {
  const {
    user,
    memberships,
    activeMembership,
    selectOrganization,
    can,
    signOut,
    isPlatformAdmin,
    refreshMemberships,
  } = useAuth();

  const { branding, refresh: refreshBranding } = useTenantBranding();
  const [applyingLogoPalette, setApplyingLogoPalette] = useState(false);
  const [brandingNotice, setBrandingNotice] = useState('');
  const logoUrl = safeBrandUrl(branding.logoUrl);
  const websiteUrl = safeBrandUrl(branding.website);
  const tenantPrimary = safeTenantColor(branding.primaryColor, TENANT_DEFAULT_PRIMARY);
  const tenantSecondary = safeTenantColor(branding.secondaryColor, TENANT_DEFAULT_SECONDARY);
  const [view, setView] = useState<DashboardView>('DASHBOARD');
  const [clientPortalMode,setClientPortalMode]=useState(true);
  // Presentation-only: never changes the Supabase token, SQL RLS or user
  // grants. This role preview is not a substitute for a security test.
  const [tenantPreviewRole,setTenantPreviewRole]=useState<'OWNER'|'ADMIN'>('OWNER');
  const mode=tenantAccessMode(activeMembership?.roles??[]);
  useEffect(()=>{
    // Start in the private portal when CLIENT is one of the assigned roles.
    // Mixed-role accounts may explicitly choose administration, but do not
    // represent a valid restricted-client security test.
    setClientPortalMode(mode.clientLinkedRole);
  },[activeMembership?.member.id,activeMembership?.organization.id,mode.clientLinkedRole]);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [loadingStats, setLoadingStats] = useState(false);

  const [termsRequired, setTermsRequired] = useState(false);
  const [licenseCheckLoading, setLicenseCheckLoading] = useState(true);

  const organizationId = activeMembership?.organization.id;
  const billingOwner = activeMembership?.billing.can_manage_billing ?? false;
  const previewAsTenant=isPlatformAdmin&&Boolean(activeMembership);
  const selectedPreviewMode=clientPortalMode&&mode.clientLinkedRole?'CLIENT':tenantPreviewRole;
  function changePreviewMode(next:string){
    if(!previewAsTenant)return;
    if(next==='PLATFORM'){
      window.location.assign('/super-admin');
      return;
    }
    if(next==='CLIENT'){
      if(!mode.clientLinkedRole)return;
      setClientPortalMode(true);
      setView('PORTAL');
      return;
    }
    if(next==='OWNER'||next==='ADMIN'){
      setTenantPreviewRole(next);
      setClientPortalMode(false);
      setView('DASHBOARD');
    }
  }
  const previewSelector=previewAsTenant?<label className="inline-flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
    Vista de prueba
    <select aria-label="Elegir vista de prueba de la inmobiliaria"
      value={selectedPreviewMode} onChange={event=>changePreviewMode(event.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium">
      <option value="OWNER">Titular de la inmobiliaria</option>
      <option value="ADMIN">Administrador de inmobiliaria</option>
      {mode.clientLinkedRole&&<option value="CLIENT">Cliente · Mi portal privado</option>}
      <option value="PLATFORM">Salir de prueba · Superadministrador</option>
    </select>
  </label>:null;

  async function applyLogoPalette() {
    if (!organizationId || !can(PERMISSIONS.SETTINGS_EDIT) || !logoUrl || applyingLogoPalette) return;
    setApplyingLogoPalette(true);
    setBrandingNotice('');
    try {
      const palette = await paletteFromLogoUrl(logoUrl);
      const { error } = await supabase.from('organization_branding').upsert({
        organization_id: organizationId,
        primary_color: palette.primary,
        secondary_color: palette.secondary,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id' });
      if (error) throw new Error('No se pudieron guardar los colores. Comprueba tus permisos.');
      await refreshBranding();
      window.dispatchEvent(new Event('tenant-branding-updated'));
      setBrandingNotice('Portada adaptada a los colores del logo de esta inmobiliaria.');
    } catch (error) {
      setBrandingNotice(error instanceof Error ? error.message : 'No fue posible adaptar los colores.');
    } finally { setApplyingLogoPalette(false); }
  }

  useEffect(() => {
    if (!organizationId || !user) {
      setTermsRequired(false);
      setLicenseCheckLoading(false);
      return;
    }

    const isOwner = activeMembership?.billing.can_manage_billing ?? false;
    if (!isOwner) {
      setTermsRequired(false);
      setLicenseCheckLoading(false);
      return;
    }

    let cancelled = false;
    setLicenseCheckLoading(true);

    void (async () => {
      const { data: access, error } = await supabase.rpc('billing_get_access', { target_org: organizationId });
      if (error || !access) {
        if (!cancelled) {
          setTermsRequired(true);
          setLicenseCheckLoading(false);
          setView('LICENSE');
        }
        return;
      }

      if (!cancelled) {
        const required = !access.terms_accepted;
        setTermsRequired(required);
        setLicenseCheckLoading(false);
        if (required) setView('LICENSE');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId, user?.id, billingOwner]);

  useEffect(() => {
    if (!organizationId) {
      setStats(EMPTY_STATS);
      return;
    }
    // Refresh the counters whenever a user returns from an operational panel.
    if (view !== 'DASHBOARD') return;
    if (mode.clientLinkedRole && clientPortalMode) return;

    let cancelled = false;

    async function loadStats() {
      setLoadingStats(true);

      const requests = [
        can(PERMISSIONS.PROPERTIES_VIEW)
          ? supabase.from('properties').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)
          : Promise.resolve({ count: 0 }),
        can(PERMISSIONS.CLIENTS_VIEW)
          ? supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)
          : Promise.resolve({ count: 0 }),
        can(PERMISSIONS.LEADS_VIEW)
          ? supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)
          : Promise.resolve({ count: 0 }),
        can(PERMISSIONS.APPOINTMENTS_VIEW)
          ? supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)
          : Promise.resolve({ count: 0 }),
        can(PERMISSIONS.DEALS_VIEW)
          ? supabase.from('deals').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)
          : Promise.resolve({ count: 0 }),
      ];

      const [properties, contacts, leads, appointments, deals] = await Promise.all(requests);

      if (!cancelled) {
        setStats({
          properties: properties.count ?? 0,
          contacts: contacts.count ?? 0,
          leads: leads.count ?? 0,
          appointments: appointments.count ?? 0,
          deals: deals.count ?? 0,
        });
        setLoadingStats(false);
      }
    }

    void loadStats();

    return () => {
      cancelled = true;
    };
  }, [organizationId, can, view, clientPortalMode, mode.clientLinkedRole]);

  const menuItems = useMemo(
    () =>
      [
        { id: 'DASHBOARD', icon: LayoutDashboard }, { id: 'PROPERTIES', icon: Building2 },
        { id: 'CONTACTS', icon: ContactRound }, { id: 'RENTAL_INTAKE', icon: ScrollText }, { id: 'LEADS', icon: UsersRound },
        { id: 'APPOINTMENTS', icon: CalendarDays }, { id: 'DEALS', icon: Handshake },
        { id: 'OWNERS', icon: UserRoundCog }, { id: 'DOCUMENTS', icon: FileText },
        { id: 'COMMISSIONS', icon: BadgeDollarSign }, { id: 'REPORTS', icon: BarChart3 },
        { id: 'PORTAL', icon: UserCircle2 }, { id: 'USERS', icon: UsersRound },
        { id: 'IMPORT', icon: FileSpreadsheet }, { id: 'SETTINGS', icon: Settings }, { id: 'LICENSE', icon: ScrollText },
      ].flatMap(icon => tenantMenu(can, billingOwner, termsRequired).filter(item => item.id === icon.id).map(item => ({ ...item, icon: icon.icon }))),
    [can, billingOwner, termsRequired],
  );

  // Cards and sidebar must go through the same permission-checked navigation.
  function navigateToOperationalPanel(target: DashboardView) {
    const destination = menuItems.find(item => item.id === target);
    if (!destination?.available) return;
    setView(target);
  }

  if (!user) return null;
  if (!activeMembership) {
    return <main className="min-h-screen bg-stone-100 p-6 text-slate-900">
      <div className="mx-auto max-w-3xl rounded-2xl border border-stone-200 bg-white p-8">
        <h1 className="text-2xl font-bold">Panel inmobiliario</h1>
        <p className="mt-3 text-slate-700">Tu cuenta tiene acceso a la administración central, pero todavía no dispone de una membresía activa en una inmobiliaria. Para ver propiedades, clientes, CRM y demás módulos necesitas que una inmobiliaria te asigne un perfil autorizado.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {isPlatformAdmin && <a href="/super-admin" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Administración central · Superadministrador</a>}
{isPlatformAdmin && <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 font-semibold">Volver al inicio</button>}
        </div>
      </div>
    </main>;
  }

  if (!activeMembership.billing.operational && mode.portalOnly) {
    return <main className="min-h-screen bg-stone-100 p-6 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-xl border bg-white p-6">
        <h1 className="text-xl font-bold">Portal privado temporalmente no disponible</h1>
        <p className="mt-2 text-sm">La inmobiliaria debe regularizar el estado de su servicio.
          No se puede gestionar facturación desde una cuenta de Cliente.</p>
        <button type="button" onClick={()=>void signOut()} className="mt-4 rounded-lg border px-4 py-2">
          Cerrar sesión
        </button>
      </section>
    </main>;
  }
  if (!activeMembership.billing.operational) {
    return <main className="min-h-screen bg-stone-100 p-5 text-slate-900"><div className="mx-auto max-w-6xl">
      <header className="mb-6 flex justify-between gap-3"><h1 className="font-bold">{activeMembership.organization.name}</h1>
{isPlatformAdmin && <button type="button" onClick={onClose} className="rounded-lg border bg-white px-4 py-2">Volver al inicio</button>}</header>
      <BillingModule key={organizationId} />
    </div></main>;
  }

  if (mode.portalOnly || (mode.clientLinkedRole&&clientPortalMode)) {
    return <div className="min-h-screen bg-stone-100 text-slate-900">
      <header className="border-b border-stone-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">{activeMembership.organization.name} · Portal privado</h1>
            <p className="text-sm text-slate-600">{activeMembership.organization.name} · Cliente / propietario de inmueble</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {previewSelector}
            <a href={tenantPublicPath(activeMembership.organization.slug)} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">
              Ver portada pública
            </a>
            {mode.hasOperationalRole&&!previewAsTenant&&<button type="button" onClick={()=>{setClientPortalMode(false);setView('DASHBOARD');}}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
              Cambiar a administración
            </button>}
{isPlatformAdmin && <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm">Volver</button>}
            <button type="button" onClick={()=>void signOut()} className="rounded-lg border px-3 py-2 text-sm">Salir</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 p-5">
        {mode.mixedElevated&&<div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          Esta misma cuenta también tiene permisos administrativos. La vista privada oculta
          los módulos internos, pero NO reduce los privilegios de tu sesión.
          Para verificar la seguridad real de Cliente, utiliza otra cuenta que tenga
          únicamente el rol CLIENT y su vínculo de portal.
        </div>}
        <PortalHub/>
      </main>
    </div>;
  }

  return (
    <div className="min-h-screen bg-stone-100 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur" style={branding.primaryColor ? { borderBottomColor: tenantPrimary } : undefined}>
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-white" aria-label="Logo de la inmobiliaria">
              {logoUrl ? <img src={logoUrl} alt={'Logo de ' + activeMembership.organization.name} className="max-h-full max-w-full object-contain p-1.5" /> :
                <Building2 className="h-7 w-7 text-slate-500" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Panel privado de la inmobiliaria
              </div>
              <div className="truncate text-lg font-bold" aria-label="Inmobiliaria activa" style={branding.primaryColor ? { color: tenantPrimary } : undefined}>{activeMembership.organization.name}</div>
              <p className="text-xs text-slate-600">{activeMembership.billing.is_test ? 'Cuenta de prueba · Solo datos de esta inmobiliaria' : 'Cuenta inmobiliaria · Solo datos de esta inmobiliaria'}</p>
              {websiteUrl && <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-600 hover:underline">
                <ExternalLink className="h-3 w-3" /> Sitio web de la inmobiliaria
              </a>}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {can(PERMISSIONS.SETTINGS_EDIT) && logoUrl && <button type="button" onClick={() => void applyLogoPalette()} disabled={applyingLogoPalette} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold disabled:opacity-50" title="Guardar únicamente los colores de esta inmobiliaria">
              <Palette className="h-4 w-4" /> {applyingLogoPalette ? 'Analizando…' : 'Adaptar colores al logo'}
            </button>}
            {previewSelector}
            <a href={tenantPublicPath(activeMembership.organization.slug)}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
              aria-label="Ver portada pública de esta inmobiliaria (se abre en otra pestaña)">
              <ExternalLink className="h-4 w-4" /> Ver portada pública
            </a>
            {mode.clientLinkedRole&&!previewAsTenant&&<button type="button" onClick={()=>setClientPortalMode(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">
              Abrir mi portal privado
            </button>}
            {isPlatformAdmin && <a href="/super-admin" className={'inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 '+(previewAsTenant?'hidden':'')}><ShieldCheck className="h-4 w-4" />Superadministrador</a>}
            {memberships.length > 1 && (
              <select
                value={activeMembership.organization.id}
                onChange={(event) => selectOrganization(event.target.value)}
                className="max-w-52 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                aria-label="Cambiar inmobiliaria"
              >
                {memberships.map((membership) => (
                  <option key={membership.organization.id} value={membership.organization.id}>
                    {membership.organization.name}
                  </option>
                ))}
              </select>
            )}

{isPlatformAdmin && <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium"
            >
              <Home className="h-4 w-4" />
              Portal
            </button>}

            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium"
            >
              <LogOut className="h-4 w-4" />
              Salir
            </button>
          </div>
        </div>
      </header>

      {previewAsTenant&&<div role="status" className="mx-auto max-w-[1500px] px-4 pt-3 text-xs text-amber-900 md:px-6">
        Vista de prueba como {tenantPreviewRole==='ADMIN'?'administrador':'titular de inmobiliaria'}.
        Los permisos reales de superadministrador no cambian; para comprobar el aislamiento de seguridad se necesita otra cuenta sin esos privilegios.
      </div>}
      {brandingNotice && <p role="status" className="mx-auto max-w-[1500px] px-4 pt-3 text-sm text-slate-700 md:px-6">{brandingNotice}</p>}
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-5 px-4 py-5 md:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-stone-200 bg-white p-2">
          <nav className="space-y-1" aria-label="Módulos del sistema">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.id || (view === 'CONSIGNMENTS' && item.id === 'PROPERTIES') || (view === 'BILLING' && item.id === 'LICENSE');
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!item.available}
                  title={!item.available ? termsRequired ? 'Acepta la licencia para continuar' : 'Módulo fuera de tus permisos actuales' : undefined}
                  onClick={() => navigateToOperationalPanel(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-stone-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50'
                  }`}
                  style={active && branding.primaryColor ? { backgroundColor: tenantPrimary } : undefined}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span>{item.label}</span>
                  {!item.available && <LockKeyhole className="ml-auto h-3 w-3" aria-hidden="true" />}
                </button>
              );
            })}
          </nav>

        </aside>

        <main className="min-w-0">
          {termsRequired && !licenseCheckLoading && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <div className="font-bold">Aceptación de licencia requerida</div>
              <p className="mt-1">
                Como propietario de la organización debes aceptar los términos vigentes antes de utilizar los módulos operativos.
              </p>
            </div>
          )}

          {view === 'DASHBOARD' && !termsRequired && (
            <DashboardHome
              stats={stats}
              loading={loadingStats}
              organizationName={activeMembership.organization.name}
              roleNames={previewAsTenant?
                [tenantPreviewRole==='ADMIN'?'Administrador de inmobiliaria (simulación)':'Titular de la inmobiliaria (simulación)']:
                activeMembership.roles.map(displayTenantRole)}
              tenantPrimary={tenantPrimary}
              tenantSecondary={tenantSecondary}
              themed={Boolean(branding.primaryColor)}
              onNavigate={navigateToOperationalPanel}
              can={can}
            />
          )}

          {(view === 'PROPERTIES' || view === 'CONSIGNMENTS') && !termsRequired && can(PERMISSIONS.PROPERTIES_VIEW) && <>
            {can(PERMISSIONS.CLIENTS_VIEW) && <div className="mb-4 flex gap-2" aria-label="Gestión de propiedades">
              <button type="button" onClick={() => setView('PROPERTIES')} className={`rounded-lg border px-4 py-2 text-sm ${view === 'PROPERTIES' ? 'bg-slate-900 text-white' : 'bg-white'}`}>Inventario</button>
              <button type="button" onClick={() => setView('CONSIGNMENTS')} className={`rounded-lg border px-4 py-2 text-sm ${view === 'CONSIGNMENTS' ? 'bg-slate-900 text-white' : 'bg-white'}`}>Consignaciones</button>
            </div>}
            {view === 'PROPERTIES' ? <PropertiesModule /> : can(PERMISSIONS.CLIENTS_VIEW) && <PropertyConsignmentsModule key={organizationId} />}
          </>}
          {view === 'CONTACTS' && !termsRequired && can(PERMISSIONS.CLIENTS_VIEW) && <ContactsModule />}
          {view === 'RENTAL_INTAKE' && !termsRequired && can(PERMISSIONS.LEASES_VIEW) && organizationId &&
            <RentalIntakeWizard key={organizationId} organizationId={organizationId} />}
          {view === 'LEADS' && !termsRequired && can(PERMISSIONS.LEADS_VIEW) && <LeadsModule />}
          {view === 'APPOINTMENTS' && !termsRequired && can(PERMISSIONS.APPOINTMENTS_VIEW) && <AppointmentsModule />}
          {view === 'DEALS' && !termsRequired && can(PERMISSIONS.DEALS_VIEW) && <DealsModule />}
          {view === 'IMPORT' && !termsRequired && (can(PERMISSIONS.CLIENTS_CREATE) || can(PERMISSIONS.PROPERTIES_CREATE)) && <DataImportCenter />}
          {view === 'USERS' && !termsRequired && can(PERMISSIONS.USERS_VIEW) && <UsersRolesModule />}
          {view === 'SETTINGS' && !termsRequired && can(PERMISSIONS.SETTINGS_VIEW) && <SettingsModule />}
          {view === 'LICENSE' && (billingOwner || can(PERMISSIONS.SETTINGS_VIEW)) && (
            <>
            {billingOwner && <button type="button" onClick={() => setView('BILLING')} className="mb-4 rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Plan y activación</button>}
            <LicenseModule
              onAccepted={() => {
                setTermsRequired(false);
                void refreshMemberships();
                setView('DASHBOARD');
              }}
            />
            </>
          )}
          {view === 'BILLING' && billingOwner && <><button type="button" onClick={() => setView('LICENSE')} className="mb-4 rounded-lg border bg-white px-4 py-2 text-sm">Volver a licencia</button><BillingModule key={organizationId} /></>}
          {view === 'OWNERS' && !termsRequired && can(PERMISSIONS.OWNERS_VIEW) && <OwnersModule />}
          {view === 'DOCUMENTS' && !termsRequired && can(PERMISSIONS.DOCUMENTS_VIEW) && <DocumentsModule />}
          {view === 'COMMISSIONS' && !termsRequired && can(PERMISSIONS.COMMISSIONS_VIEW) && <CommissionsModule />}
          {view === 'REPORTS' && !termsRequired && can(PERMISSIONS.REPORTS_VIEW) && <ReportsModule />}
          {view === 'PORTAL' && !termsRequired && <PortalHub />}

          {view !== 'DASHBOARD' && view !== 'PROPERTIES' && view !== 'CONSIGNMENTS' && view !== 'CONTACTS' && view !== 'RENTAL_INTAKE' && view !== 'LEADS' && view !== 'APPOINTMENTS' && view !== 'DEALS' && view !== 'USERS' && view !== 'IMPORT' && view !== 'SETTINGS' && view !== 'LICENSE' && view !== 'BILLING' && view !== 'OWNERS' && view !== 'DOCUMENTS' && view !== 'COMMISSIONS' && view !== 'REPORTS' && view !== 'PORTAL' && (
            <ModuleComingOnline
              title={menuItems.find((item) => item.id === view)?.label ?? 'Módulo'}
              onClose={() => setView('DASHBOARD')}
            />
          )}
        </main>
      </div>
    </div>
  );
}

interface DashboardHomeProps {
  stats: DashboardStats;
  loading: boolean;
  organizationName: string;
  roleNames: string[];
  tenantPrimary: string;
  tenantSecondary: string;
  themed: boolean;
  onNavigate: (view: DashboardView) => void;
  can: (permission: string) => boolean;
}

function DashboardHome({
  stats,
  loading,
  organizationName,
  roleNames,
  tenantPrimary,
  tenantSecondary,
  themed,
  onNavigate,
  can,
}: DashboardHomeProps) {
  const shortcutIcons = {
    PROPERTIES: Building2,
    CONTACTS: ContactRound,
    LEADS: UsersRound,
    APPOINTMENTS: CalendarDays,
    DEALS: Handshake,
  } as const;
  const cards = permittedDashboardShortcuts(can).map(shortcut => ({
    ...shortcut,
    value: stats[shortcut.metric],
    icon: shortcutIcons[shortcut.target],
  }));

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-stone-200 bg-white p-5 md:p-6" style={themed ? { backgroundColor: tenantSecondary, borderColor: tenantPrimary } : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-500">Panel de gestión</div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight" style={themed ? { color: tenantPrimary } : undefined}>{organizationName}</h1>
            <p className="mt-2 text-sm text-slate-600">
              Tu información está aislada por inmobiliaria y cada módulo respeta los permisos asignados.
            </p>
          </div>
          <div className="rounded-xl bg-stone-100 px-4 py-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Roles activos</div>
            <div className="mt-1 font-semibold text-slate-900">
              {roleNames.length ? roleNames.join(', ') : 'Sin rol asignado'}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => onNavigate(card.target)}
              aria-label={`Abrir panel de ${card.label}`}
              title={`Ir a ${card.label}`}
              className="group cursor-pointer rounded-2xl border border-stone-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-slate-500 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
            >
              <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl bg-stone-100" style={themed ? { backgroundColor: tenantSecondary, color: tenantPrimary } : undefined}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-3xl font-bold tabular-nums" style={themed ? { color: tenantPrimary } : undefined}>{loading ? '—' : card.value}</div>
              <div className="mt-1 text-sm text-slate-600">{card.label}</div>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-700 group-hover:underline">
                Abrir panel <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="font-bold">Primeros pasos</h2>
          <div className="mt-4 space-y-3 text-sm">
            <Step number="1" text="Completa los datos y branding de la inmobiliaria." />
            <Step number="2" text="Crea administradores, asesores y clientes según sea necesario." />
            <Step number="3" text="Registra propiedades o importa información existente." />
            <Step number="4" text="Empieza a recibir y gestionar leads desde el CRM." />
          </div>
        </div>

        {(can(PERMISSIONS.CLIENTS_CREATE) || can(PERMISSIONS.PROPERTIES_CREATE)) && (
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="font-bold">¿Ya tienes información?</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Puedes empezar desde cero o migrar clientes y propiedades desde Excel o CSV cuando quieras.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('IMPORT')}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              style={themed ? { backgroundColor: tenantPrimary } : undefined}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Importar datos
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
        {number}
      </div>
      <div className="pt-1 text-slate-700">{text}</div>
    </div>
  );
}

function ModuleComingOnline({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100">
        <Settings className="h-5 w-5" />
      </div>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">
        Este módulo ya tiene base de datos y permisos definidos. La siguiente etapa incorpora su interfaz operativa completa.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-5 inline-flex items-center gap-2 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold"
      >
        <X className="h-4 w-4" />
        Volver al inicio
      </button>
    </section>
  );
}
