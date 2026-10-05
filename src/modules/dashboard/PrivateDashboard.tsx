import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  ContactRound,
  FileSpreadsheet,
  FileText,
  Handshake,
  Home,
  LayoutDashboard,
  LogOut,
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
import { supabase } from '../../lib/supabase';
import { DataImportCenter } from '../imports/DataImportCenter';
import { PropertiesModule } from '../properties/PropertiesModule';
import { ContactsModule } from '../contacts/ContactsModule';
import { LeadsModule } from '../leads/LeadsModule';
import { AppointmentsModule } from '../appointments/AppointmentsModule';
import { DealsModule } from '../deals/DealsModule';
import { SettingsModule } from '../settings/SettingsModule';
import { UsersRolesModule } from '../users/UsersRolesModule';
import { LicenseModule } from '../license/LicenseModule';
import { OwnersModule } from '../owners/OwnersModule';
import { DocumentsModule } from '../documents/DocumentsModule';
import { CommissionsModule } from '../commissions/CommissionsModule';
import { ReportsModule } from '../reports/ReportsModule';
import { PortalHub } from '../portal/PortalHub';
import { SuperAdminModule } from '../platform/SuperAdminModule';
import { useTenantBranding } from '../../core/use-tenant-branding';

type DashboardView =
  | 'DASHBOARD'
  | 'PROPERTIES'
  | 'CONTACTS'
  | 'LEADS'
  | 'APPOINTMENTS'
  | 'DEALS'
  | 'USERS'
  | 'IMPORT'
  | 'SETTINGS'
  | 'LICENSE'
  | 'OWNERS'
  | 'DOCUMENTS'
  | 'COMMISSIONS'
  | 'REPORTS'
  | 'PORTAL'
  | 'SUPER_ADMIN';

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
  } = useAuth();

  const { branding } = useTenantBranding();
  const [view, setView] = useState<DashboardView>('DASHBOARD');
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [loadingStats, setLoadingStats] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [termsRequired, setTermsRequired] = useState(false);
  const [licenseCheckLoading, setLicenseCheckLoading] = useState(true);

  const organizationId = activeMembership?.organization.id;

  useEffect(() => {
    if (!user) {
      setIsPlatformAdmin(false);
      return;
    }

    supabase.rpc('is_platform_admin').then(({ data }) => {
      setIsPlatformAdmin(Boolean(data));
    });
  }, [user?.id]);

  useEffect(() => {
    if (!organizationId || !user) {
      setTermsRequired(false);
      setLicenseCheckLoading(false);
      return;
    }

    const isOwner = activeMembership?.roles.some((role) => role.key === 'ORGANIZATION_OWNER') ?? false;
    if (!isOwner) {
      setTermsRequired(false);
      setLicenseCheckLoading(false);
      return;
    }

    let cancelled = false;
    setLicenseCheckLoading(true);

    void (async () => {
      const { data: license } = await supabase
        .from('organization_licenses')
        .select('id,terms_version_id')
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (!license?.id || !license?.terms_version_id) {
        if (!cancelled) {
          setTermsRequired(true);
          setLicenseCheckLoading(false);
          setView('LICENSE');
        }
        return;
      }

      const { data: acceptance } = await supabase
        .from('license_acceptances')
        .select('id')
        .eq('organization_license_id', license.id)
        .eq('terms_version_id', license.terms_version_id)
        .eq('accepted_by', user.id)
        .maybeSingle();

      if (!cancelled) {
        const required = !acceptance;
        setTermsRequired(required);
        setLicenseCheckLoading(false);
        if (required) setView('LICENSE');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId, user?.id, activeMembership?.roles]);

  useEffect(() => {
    if (!organizationId) {
      setStats(EMPTY_STATS);
      return;
    }

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
  }, [organizationId, can]);

  const menuItems = useMemo(
    () =>
      [
        { id: 'DASHBOARD' as const, label: 'Inicio', icon: LayoutDashboard, visible: !termsRequired },
        { id: 'PROPERTIES' as const, label: 'Propiedades', icon: Building2, visible: can(PERMISSIONS.PROPERTIES_VIEW) },
        { id: 'CONTACTS' as const, label: 'Clientes', icon: ContactRound, visible: can(PERMISSIONS.CLIENTS_VIEW) },
        { id: 'LEADS' as const, label: 'Leads / CRM', icon: UsersRound, visible: can(PERMISSIONS.LEADS_VIEW) },
        { id: 'APPOINTMENTS' as const, label: 'Agenda', icon: CalendarDays, visible: can(PERMISSIONS.APPOINTMENTS_VIEW) },
        { id: 'DEALS' as const, label: 'Negocios', icon: Handshake, visible: can(PERMISSIONS.DEALS_VIEW) },
        { id: 'OWNERS' as const, label: 'Propietarios', icon: UserRoundCog, visible: can(PERMISSIONS.OWNERS_VIEW) },
        { id: 'DOCUMENTS' as const, label: 'Documentos', icon: FileText, visible: can(PERMISSIONS.DOCUMENTS_VIEW) },
        { id: 'COMMISSIONS' as const, label: 'Comisiones', icon: BadgeDollarSign, visible: can(PERMISSIONS.COMMISSIONS_VIEW) },
        { id: 'REPORTS' as const, label: 'Reportes', icon: BarChart3, visible: can(PERMISSIONS.REPORTS_VIEW) },
        { id: 'PORTAL' as const, label: 'Mi Portal', icon: UserCircle2, visible: true },
        { id: 'SUPER_ADMIN' as const, label: 'Super Admin', icon: ShieldCheck, visible: isPlatformAdmin },
        { id: 'USERS' as const, label: 'Usuarios', icon: UsersRound, visible: can(PERMISSIONS.USERS_VIEW) },
        {
          id: 'IMPORT' as const,
          label: 'Importar datos',
          icon: FileSpreadsheet,
          visible: can(PERMISSIONS.CLIENTS_CREATE) || can(PERMISSIONS.PROPERTIES_CREATE),
        },
        { id: 'SETTINGS' as const, label: 'Configuración', icon: Settings, visible: can(PERMISSIONS.SETTINGS_VIEW) },
        { id: 'LICENSE' as const, label: 'Licencia', icon: ScrollText, visible: can(PERMISSIONS.SETTINGS_VIEW) },
      ].filter((item) => item.visible && (!termsRequired || item.id === 'LICENSE')),
    [can, isPlatformAdmin, termsRequired],
  );

  if (!user || !activeMembership) {
    return null;
  }

  return (
    <div className="min-h-screen bg-stone-100 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {branding.softwareName}
            </div>
            <div className="truncate text-lg font-bold">{branding.companyName}</div>
          </div>

          <div className="flex items-center gap-2">
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

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium"
            >
              <Home className="h-4 w-4" />
              Portal
            </button>

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

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-5 px-4 py-5 md:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-stone-200 bg-white p-2">
          <nav className="space-y-1" aria-label="Módulos del sistema">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ' +
                    (active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-stone-100')
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
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
              roleNames={activeMembership.roles.map((role) => role.name)}
              onNavigate={setView}
              can={can}
            />
          )}

          {view === 'PROPERTIES' && <PropertiesModule />}
          {view === 'CONTACTS' && <ContactsModule />}
          {view === 'LEADS' && <LeadsModule />}
          {view === 'APPOINTMENTS' && <AppointmentsModule />}
          {view === 'DEALS' && <DealsModule />}
          {view === 'IMPORT' && <DataImportCenter />}
          {view === 'USERS' && <UsersRolesModule />}
          {view === 'SETTINGS' && <SettingsModule />}
          {view === 'LICENSE' && (
            <LicenseModule
              onAccepted={() => {
                setTermsRequired(false);
                setView('DASHBOARD');
              }}
            />
          )}
          {view === 'OWNERS' && <OwnersModule />}
          {view === 'DOCUMENTS' && <DocumentsModule />}
          {view === 'COMMISSIONS' && <CommissionsModule />}
          {view === 'REPORTS' && <ReportsModule />}
          {view === 'PORTAL' && <PortalHub />}
          {view === 'SUPER_ADMIN' && isPlatformAdmin && <SuperAdminModule />}

          {view !== 'DASHBOARD' && view !== 'PROPERTIES' && view !== 'CONTACTS' && view !== 'LEADS' && view !== 'APPOINTMENTS' && view !== 'DEALS' && view !== 'USERS' && view !== 'IMPORT' && view !== 'SETTINGS' && view !== 'LICENSE' && view !== 'OWNERS' && view !== 'DOCUMENTS' && view !== 'COMMISSIONS' && view !== 'REPORTS' && view !== 'PORTAL' && view !== 'SUPER_ADMIN' && (
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
  onNavigate: (view: DashboardView) => void;
  can: (permission: string) => boolean;
}

function DashboardHome({
  stats,
  loading,
  organizationName,
  roleNames,
  onNavigate,
  can,
}: DashboardHomeProps) {
  const cards = [
    {
      label: 'Propiedades',
      value: stats.properties,
      icon: Building2,
      target: 'PROPERTIES' as const,
      visible: can(PERMISSIONS.PROPERTIES_VIEW),
    },
    {
      label: 'Clientes',
      value: stats.contacts,
      icon: ContactRound,
      target: 'CONTACTS' as const,
      visible: can(PERMISSIONS.CLIENTS_VIEW),
    },
    {
      label: 'Leads',
      value: stats.leads,
      icon: UsersRound,
      target: 'LEADS' as const,
      visible: can(PERMISSIONS.LEADS_VIEW),
    },
    {
      label: 'Citas y visitas',
      value: stats.appointments,
      icon: CalendarDays,
      target: 'APPOINTMENTS' as const,
      visible: can(PERMISSIONS.APPOINTMENTS_VIEW),
    },
    {
      label: 'Negocios',
      value: stats.deals,
      icon: Handshake,
      target: 'DEALS' as const,
      visible: can(PERMISSIONS.DEALS_VIEW),
    },
  ].filter((card) => card.visible);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-stone-200 bg-white p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-500">Panel de gestión</div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{organizationName}</h1>
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
              className="rounded-2xl border border-stone-200 bg-white p-4 text-left hover:border-slate-400"
            >
              <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl bg-stone-100">
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-3xl font-bold tabular-nums">{loading ? '—' : card.value}</div>
              <div className="mt-1 text-sm text-slate-600">{card.label}</div>
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
