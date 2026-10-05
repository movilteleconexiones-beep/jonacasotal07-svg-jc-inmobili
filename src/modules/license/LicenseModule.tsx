import { useEffect, useState } from 'react';
import { Copyright, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { supabase } from '../../lib/supabase';

interface LicenseInfo {
  id?: string;
  license_type: string;
  status: string;
  operational_control_full: boolean;
  copyright_transferred: boolean;
  resale_allowed: boolean;
  sublicensing_allowed: boolean;
  redistribution_allowed: boolean;
  white_label_allowed: boolean;
  terms_version_id?: string | null;
}

interface TermsInfo {
  id?: string;
  version: string;
  title: string;
  summary: string | null;
  terms_markdown: string;
  effective_date: string;
}

export function LicenseModule({ onAccepted }: { onAccepted?: () => void } = {}) {
  const { activeMembership, user } = useAuth();
  const organizationId = activeMembership?.organization.id;
  const isOrganizationOwner = activeMembership?.roles.some((role) => role.key === 'ORGANIZATION_OWNER') ?? false;
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [terms, setTerms] = useState<TermsInfo | null>(null);
  const [licenseId, setLicenseId] = useState<string | null>(null);
  const [termsId, setTermsId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!organizationId) return;

    void Promise.all([
      supabase
        .from('organization_licenses')
        .select('id,license_type,status,operational_control_full,copyright_transferred,resale_allowed,sublicensing_allowed,redistribution_allowed,white_label_allowed,terms_version_id')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase
        .from('license_terms_versions')
        .select('id,version,title,summary,terms_markdown,effective_date')
        .eq('active', true)
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(async ([licenseResult, termsResult]) => {
      const licenseData = licenseResult.data as any;
      const termsData = termsResult.data as any;
      setLicense((licenseData ?? null) as LicenseInfo | null);
      setTerms((termsData ?? null) as TermsInfo | null);
      setLicenseId(licenseData?.id ?? null);
      setTermsId(termsData?.id ?? null);

      if (isOrganizationOwner && licenseData?.id && termsData?.id && user?.id) {
        const { data } = await supabase
          .from('license_acceptances')
          .select('id')
          .eq('organization_license_id', licenseData.id)
          .eq('terms_version_id', termsData.id)
          .eq('accepted_by', user.id)
          .maybeSingle();
        setAccepted(Boolean(data));
      } else {
        setAccepted(false);
      }
    });
  }, [organizationId, user?.id, isOrganizationOwner]);

  async function acceptTerms() {
    if (!isOrganizationOwner || !licenseId || !termsId || !user?.id || accepting) return;
    setAccepting(true);
    setMessage('');

    const { error } = await supabase.from('license_acceptances').insert({
      organization_license_id: licenseId,
      terms_version_id: termsId,
      accepted_by: user.id,
      accepted_at: new Date().toISOString(),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });

    if (error && !error.message.toLowerCase().includes('duplicate')) {
      setMessage(error.message);
      setAccepting(false);
      return;
    }

    setAccepted(true);
    setMessage('Términos aceptados y registrados correctamente.');
    setAccepting(false);
    onAccepted?.();
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Licencia y propiedad intelectual</h1>
        <p className="mt-1 text-sm text-slate-600">
          Consulta el alcance de uso del software y las restricciones de propiedad intelectual.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold">Derechos operativos</div>
              <div className="text-sm text-slate-500">
                {license ? license.license_type : 'Pendiente de asignación comercial'}
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-2 text-sm">
            <Rule label="Control operativo total" value={license?.operational_control_full ?? false} />
            <Rule label="Marca blanca permitida" value={license?.white_label_allowed ?? false} />
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100">
              <Copyright className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold">Propiedad intelectual</div>
              <div className="text-sm text-slate-500">Restricciones permanentes salvo pacto escrito</div>
            </div>
          </div>

          <div className="mt-5 space-y-2 text-sm">
            <Rule label="Derechos de autor transferidos" value={license?.copyright_transferred ?? false} />
            <Rule label="Reventa permitida" value={license?.resale_allowed ?? false} />
            <Rule label="Sublicenciamiento permitido" value={license?.sublicensing_allowed ?? false} />
            <Rule label="Redistribución permitida" value={license?.redistribution_allowed ?? false} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <div className="font-bold">Responsabilidad de la organización usuaria</div>
        <p className="mt-2 leading-relaxed">
          INMOJCO proporciona tecnología de gestión. La inmobiliaria usuaria y sus proveedores son responsables
          de la legalidad de su operación, contratos, pólizas y seguros, avalúos, manejo de dinero, obligaciones
          tributarias, protección de datos y demás servicios profesionales o empresariales que ofrezcan o gestionen.
          El uso del software no constituye asesoría jurídica, financiera, tributaria, aseguradora, notarial ni
          inmobiliaria por parte de INMOJCO.
        </p>
      </div>

      {terms && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">{terms.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{terms.summary}</p>
            </div>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold">
              Versión {terms.version}
            </span>
          </div>

          <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{isOrganizationOwner ? (accepted ? 'Términos aceptados' : 'Aceptación requerida') : 'Términos vigentes'}</div>
                <div className="mt-1 text-xs text-slate-600">
                  {!isOrganizationOwner
                    ? 'Puedes consultar estos términos. Solo el propietario de la organización puede aceptarlos.'
                    : accepted
                      ? 'La aceptación de esta versión quedó registrada para tu usuario.'
                      : 'Debes aceptar la versión vigente como propietario de la organización para habilitar la operación.'}
                </div>
              </div>
              {isOrganizationOwner && !accepted && (
                <button
                  type="button"
                  onClick={() => void acceptTerms()}
                  disabled={accepting || !licenseId || !termsId}
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {accepting ? 'Registrando…' : 'Acepto los términos'}
                </button>
              )}
            </div>
            {message && <div className="mt-3 text-xs font-medium">{message}</div>}
          </div>

          <details className="mt-5">
            <summary className="cursor-pointer text-sm font-semibold">Ver términos completos</summary>
            <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-stone-50 p-4 text-xs leading-relaxed text-slate-700">
              {terms.terms_markdown}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}

function Rule({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-stone-50 px-3 py-2">
      <span>{label}</span>
      <span className={value ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-700'}>
        {value ? 'Sí' : 'No'}
      </span>
    </div>
  );
}
