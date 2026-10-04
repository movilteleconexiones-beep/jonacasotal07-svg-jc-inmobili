import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { supabase } from '../lib/supabase';

export interface TenantBrandingState {
  companyName: string;
  softwareName: string;
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
  timezone: string;
}

const DEFAULTS: TenantBrandingState = {
  companyName: 'JC Inmobili',
  softwareName: 'JC Inmobili Software',
  currency: 'COP',
  country: 'CO',
  timezone: 'America/Bogota',
};

export function useTenantBranding() {
  const { activeMembership } = useAuth();
  const [branding, setBranding] = useState<TenantBrandingState>(DEFAULTS);
  const [loading, setLoading] = useState(false);

  const organizationId = activeMembership?.organization.id;

  const refresh = useCallback(async () => {
    if (!organizationId) {
      setBranding(DEFAULTS);
      return;
    }

    setLoading(true);
    const [brandingResult, settingsResult] = await Promise.all([
      supabase
        .from('organization_branding')
        .select('company_name, software_name, logo_url, favicon_url, primary_color, secondary_color, website, phone, whatsapp, email')
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase
        .from('organization_settings')
        .select('default_currency, country, timezone')
        .eq('organization_id', organizationId)
        .maybeSingle(),
    ]);

    setBranding({
      companyName:
        brandingResult.data?.company_name ||
        activeMembership.organization.name ||
        DEFAULTS.companyName,
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
      timezone: settingsResult.data?.timezone || 'America/Bogota',
    });
    setLoading(false);
  }, [organizationId, activeMembership?.organization.name]);

  useEffect(() => {
    void refresh();

    const onBrandingUpdated = () => void refresh();
    window.addEventListener('tenant-branding-updated', onBrandingUpdated);

    return () => {
      window.removeEventListener('tenant-branding-updated', onBrandingUpdated);
    };
  }, [refresh]);

  return { branding, loading, refresh };
}
