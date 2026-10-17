import { useEffect, useState } from 'react';
import type { PropertyConsignmentInput } from '../core/property-consignment';
import { consignmentErrorMessage } from '../core/property-consignment';
import { isSupabaseConfigured, supabase } from './supabase';
import { publicConsignmentSlug } from '../core/public-agency-route';

export interface PublicPropertyIntakeSite {
  slug: string;
  company_name: string;
  country: string;
  currency: string;
}

/**
 * Resolves the public tenant on each render, never once at module import.
 * Explicit catalog slugs are supplied by the validated public route and
 * never derived from the signed-in user's active organization.
 */
export function usePublicPropertyIntakeSite(enabled: boolean, requestedSiteSlug?:string) {
  const routeSlug=publicConsignmentSlug(
    window.location.pathname,
    import.meta.env.VITE_PUBLIC_SITE_SLUG as string | undefined,
  );
  const publicSiteSlug=requestedSiteSlug ?? routeSlug;
  const [site, setSite] = useState<PublicPropertyIntakeSite | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSite(null);
    setError('');
    setLoading(false);
    if (!enabled) return;
    if (!isSupabaseConfigured || !publicSiteSlug) {
      setError('La recepción de consignaciones aún no está configurada. Contacta directamente a la inmobiliaria.');
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_public_property_intake_site', { p_slug: publicSiteSlug });
        if (cancelled) return;
        if (rpcError || data?.slug !== publicSiteSlug || !data?.company_name || !data?.country || !data?.currency) {
          setError('La recepción de consignaciones no está disponible. Contacta directamente a la inmobiliaria.');
        } else {
          setSite(data as PublicPropertyIntakeSite);
        }
      } catch {
        if (!cancelled) setError('No se pudo conectar con la inmobiliaria. Cierra y abre el formulario para reintentar.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, publicSiteSlug]);

  return { site: site?.slug === publicSiteSlug ? site : null, loading, error };
}

export async function submitPropertyConsignment(siteSlug: string, requestId: string, payload: PropertyConsignmentInput): Promise<string> {
  const { data, error } = await supabase.rpc('submit_property_consignment', {
    p_site_slug: siteSlug,
    p_request_id: requestId,
    p_payload: payload,
  });
  if (error) throw new Error(consignmentErrorMessage(error));
  if (typeof data?.reference !== 'string' || !/^CON-[0-9A-F-]{36}$/.test(data.reference)) {
    throw new Error('No se pudo confirmar la recepción. Intenta nuevamente con los mismos datos.');
  }
  return data.reference;
}
