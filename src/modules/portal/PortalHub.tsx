import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, FileText, Handshake, UserRound } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { supabase } from '../../lib/supabase';

interface PortalLink {
  contact_id: string | null;
  owner_id: string | null;
}

interface PropertyRow {
  id: string;
  code: string;
  title: string;
  status: string;
  price: number | null;
  currency: string;
  city: string | null;
}

interface AppointmentRow {
  id: string;
  appointment_type: string;
  status: string;
  starts_at: string;
  location: string | null;
  properties: { code: string; title: string } | null;
}

interface DealRow {
  id: string;
  stage: string;
  offered_price: number | null;
  final_price: number | null;
  properties: { code: string; title: string; currency: string } | null;
}

interface DocumentRow {
  id: string;
  title: string;
  storage_bucket: string;
  storage_path: string;
  document_type: string;
  created_at: string;
}

export function PortalHub() {
  const { activeMembership } = useAuth();
  const { branding } = useTenantBranding();
  const organizationId = activeMembership?.organization.id;

  const [links, setLinks] = useState<PortalLink[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);

      const [linksResult, propertyResult, appointmentResult, dealResult, documentResult] = await Promise.all([
        supabase
          .from('portal_access_links')
          .select('contact_id,owner_id')
          .eq('organization_id', organizationId),
        supabase
          .from('properties')
          .select('id,code,title,status,price,currency,city')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false }),
        supabase
          .from('appointments')
          .select('id,appointment_type,status,starts_at,location,properties(code,title)')
          .eq('organization_id', organizationId)
          .order('starts_at', { ascending: true }),
        supabase
          .from('deals')
          .select('id,stage,offered_price,final_price,properties(code,title,currency)')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false }),
        supabase
          .from('documents')
          .select('id,title,storage_bucket,storage_path,document_type,created_at')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false }),
      ]);

      if (cancelled) return;

      setLinks((linksResult.data ?? []) as PortalLink[]);
      setProperties((propertyResult.data ?? []) as PropertyRow[]);
      setAppointments((appointmentResult.data ?? []) as unknown as AppointmentRow[]);
      setDeals((dealResult.data ?? []) as unknown as DealRow[]);
      setDocuments((documentResult.data ?? []) as DocumentRow[]);
      setLoading(false);
    }

    void load();
    return () => { cancelled = true; };
  }, [organizationId]);

  const isClient = links.some((link) => Boolean(link.contact_id));
  const isOwner = links.some((link) => Boolean(link.owner_id));

  const money = useMemo(
    () => (value: number | null, currency?: string | null) =>
      value == null
        ? '—'
        : new Intl.NumberFormat(branding.locale || 'es-CO', {
            style: 'currency',
            currency: currency || branding.currency || 'COP',
            maximumFractionDigits: 0,
          }).format(value),
    [branding.locale, branding.currency],
  );

  async function openDocument(document: DocumentRow) {
    const { data, error } = await supabase.storage
      .from(document.storage_bucket)
      .createSignedUrl(document.storage_path, 60);

    if (!error && data?.signedUrl) {
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    }
  }

  if (loading) {
    return <div className="rounded-2xl border border-stone-200 bg-white p-8 text-sm text-slate-500">Cargando portal…</div>;
  }

  if (!isClient && !isOwner) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <UserRound className="mx-auto h-7 w-7 text-slate-500" />
        <h2 className="mt-3 font-bold">Tu cuenta aún no está vinculada</h2>
        <p className="mt-2 text-sm text-slate-600">
          Un administrador debe relacionar tu usuario con tu ficha de cliente o propietario.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Mi portal</h1>
        <p className="mt-1 text-sm text-slate-600">
          {isOwner && isClient
            ? 'Vista combinada como propietario y cliente.'
            : isOwner
              ? 'Consulta tus inmuebles, actividad y documentos.'
              : 'Consulta tus visitas, negocios, propiedades relacionadas y documentos.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Propiedades relacionadas" value={properties.length} icon={Building2} />
        <Summary label="Visitas / citas" value={appointments.length} icon={CalendarDays} />
        <Summary label="Negocios" value={deals.length} icon={Handshake} />
        <Summary label="Documentos" value={documents.length} icon={FileText} />
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-4 font-bold">Propiedades</div>
        <div className="divide-y divide-stone-100">
          {properties.map((property) => (
            <div key={property.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-semibold">{property.code} · {property.title}</div>
                <div className="mt-1 text-xs text-slate-500">{property.city || '—'} · {property.status}</div>
              </div>
              <div className="text-sm font-semibold">{money(property.price, property.currency)}</div>
            </div>
          ))}
          {properties.length === 0 && <div className="p-5 text-sm text-slate-500">Sin propiedades relacionadas.</div>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-5 py-4 font-bold">Agenda</div>
          <div className="divide-y divide-stone-100">
            {appointments.map((item) => (
              <div key={item.id} className="p-4">
                <div className="font-semibold">{item.appointment_type}</div>
                <div className="mt-1 text-sm text-slate-600">
                  {new Intl.DateTimeFormat(branding.locale || 'es-CO', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: branding.timezone || 'America/Bogota',
                  }).format(new Date(item.starts_at))}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {item.properties ? item.properties.code + ' · ' + item.properties.title : item.location || '—'}
                </div>
              </div>
            ))}
            {appointments.length === 0 && <div className="p-5 text-sm text-slate-500">Sin citas programadas.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-5 py-4 font-bold">Negocios</div>
          <div className="divide-y divide-stone-100">
            {deals.map((deal) => (
              <div key={deal.id} className="p-4">
                <div className="font-semibold">{deal.properties?.code || 'Negocio'} · {deal.stage}</div>
                <div className="mt-1 text-sm text-slate-600">
                  {money(deal.final_price ?? deal.offered_price, deal.properties?.currency)}
                </div>
              </div>
            ))}
            {deals.length === 0 && <div className="p-5 text-sm text-slate-500">Sin negocios relacionados.</div>}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-4 font-bold">Documentos</div>
        <div className="divide-y divide-stone-100">
          {documents.map((document) => (
            <button
              key={document.id}
              type="button"
              onClick={() => void openDocument(document)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-stone-50"
            >
              <div>
                <div className="font-semibold">{document.title}</div>
                <div className="mt-1 text-xs text-slate-500">{document.document_type}</div>
              </div>
              <span className="text-xs font-semibold">Abrir</span>
            </button>
          ))}
          {documents.length === 0 && <div className="p-5 text-sm text-slate-500">Sin documentos disponibles.</div>}
        </div>
      </div>
    </section>
  );
}

function Summary({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <Icon className="h-5 w-5 text-slate-500" />
      <div className="mt-4 text-3xl font-bold">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{label}</div>
    </div>
  );
}
