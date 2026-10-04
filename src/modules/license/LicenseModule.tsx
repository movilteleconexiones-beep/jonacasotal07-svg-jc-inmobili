import { useEffect, useState } from 'react';
import { Copyright, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { supabase } from '../../lib/supabase';

interface LicenseInfo {
  license_type: string;
  status: string;
  operational_control_full: boolean;
  copyright_transferred: boolean;
  resale_allowed: boolean;
  sublicensing_allowed: boolean;
  redistribution_allowed: boolean;
  white_label_allowed: boolean;
}

interface TermsInfo {
  version: string;
  title: string;
  summary: string | null;
  terms_markdown: string;
  effective_date: string;
}

export function LicenseModule() {
  const { activeMembership } = useAuth();
  const organizationId = activeMembership?.organization.id;
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [terms, setTerms] = useState<TermsInfo | null>(null);

  useEffect(() => {
    if (!organizationId) return;

    void Promise.all([
      supabase
        .from('organization_licenses')
        .select('license_type,status,operational_control_full,copyright_transferred,resale_allowed,sublicensing_allowed,redistribution_allowed,white_label_allowed')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase
        .from('license_terms_versions')
        .select('version,title,summary,terms_markdown,effective_date')
        .eq('active', true)
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([licenseResult, termsResult]) => {
      setLicense((licenseResult.data ?? null) as LicenseInfo | null);
      setTerms((termsResult.data ?? null) as TermsInfo | null);
    });
  }, [organizationId]);

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
