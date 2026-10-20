import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-context';
import { supabase } from '../lib/supabase';
import { parsePublicAgencyServices, type PublicAgencyService } from './public-agency-content';
import { parsePublicPageContent, type PublicPageContent } from './public-page-content';

export interface TenantBrandingState {
  companyName: string;
  softwareName: string;
  publicHeadline?: string;
  publicDescription?: string;
  publicHeroUrl?: string;
  publicOfficeAddress?: string;
  publicServices: PublicAgencyService[];
  publicPage: PublicPageContent;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  website?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  currency: string;
  country: string;
  locale: string;
  timezone: string;
}

const DEFAULTS: TenantBrandingState = {
  companyName: 'Mi inmobiliaria',
  softwareName: 'Sistema Inmobiliario JCO',
  publicServices: [],
  publicPage: parsePublicPageContent(null),
  currency: 'COP',
  country: 'CO',
  locale: 'es-CO',
  timezone: 'America/Bogota',
};

export function useTenantBranding() {
  const { activeMembership } = useAuth();
  const [branding, setBranding] = useState<TenantBrandingState>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const loadVersion = useRef(0);

  const organizationId = activeMembership?.organization.id;

  const refresh = useCallback(async () => {
    const version = ++loadVersion.current;
    if (!organizationId) {
      setBranding(DEFAULTS);
      setLoading(false);
      return;
    }

    setBranding({ ...DEFAULTS, companyName: activeMembership?.organization.name || DEFAULTS.companyName });
    setLoading(true);
    const [brandingResult, settingsResult] = await Promise.all([
      supabase
        .from('organization_branding')
        .select('company_name, software_name, logo_url, favicon_url, primary_color, secondary_color, website, phone, whatsapp, email, public_headline, public_description, public_hero_url, public_services, public_page_content, public_office_address')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase
        .from('organization_settings')
        .select('default_currency, country, locale, timezone')
        .eq('organization_id', organizationId)
        .maybeSingle(),
    ]);

    if (version !== loadVersion.current) return;
    setBranding({
      companyName:
        brandingResult.data?.company_name ||
        activeMembership.organization.name ||
        DEFAULTS.companyName,
      publicHeadline: brandingResult.data?.public_headline ?? undefined,
      publicDescription: brandingResult.data?.public_description ?? undefined,
      publicHeroUrl: brandingResult.data?.public_hero_url ?? undefined,
      publicOfficeAddress: brandingResult.data?.public_office_address ?? undefined,
      publicServices: parsePublicAgencyServices(brandingResult.data?.public_services),
      publicPage: parsePublicPageContent(brandingResult.data?.public_page_content),
      softwareName:
        brandingResult.data?.software_name ||
        DEFAULTS.softwareName,
      logoUrl: brandingResult.data?.logo_url ?? undefined,
      faviconUrl: brandingResult.data?.favicon_url ?? undefined,
      primaryColor: brandingResult.data?.primary_color ?? undefined,
      secondaryColor: brandingResult.data?.secondary_color ?? undefined,
      website: brandingResult.data?.website ?? undefined,
      phone: brandingResult.data?.phone ?? undefined,
      whatsapp: brandingResult.data?.whatsapp ?? undefined,
      email: brandingResult.data?.email ?? undefined,
      currency: settingsResult.data?.default_currency || 'COP',
      country: settingsResult.data?.country || 'CO',
      locale: settingsResult.data?.locale || 'es-CO',
      timezone: settingsResult.data?.timezone || 'America/Bogota',
    });
    setLoading(false);
  }, [organizationId, activeMembership?.organization.name]);

  useEffect(() => {
    void refresh();

    const onBrandingUpdated = () => void refresh();
    window.addEventListener('tenant-branding-updated', onBrandingUpdated);

    return () => {
      ++loadVersion.current;
      window.removeEventListener('tenant-branding-updated', onBrandingUpdated);
    };
  }, [refresh]);

  return { branding, loading, refresh };
}
