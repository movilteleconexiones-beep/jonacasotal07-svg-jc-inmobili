import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { Organization, OrganizationBranding, OrganizationSettings } from './types';

interface OrganizationContextValue {
  organization: Organization | null;
  branding: OrganizationBranding | null;
  settings: OrganizationSettings | null;
  setOrganization: (organization: Organization | null) => void;
  setBranding: (branding: OrganizationBranding | null) => void;
  setSettings: (settings: OrganizationSettings | null) => void;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function OrganizationProvider({ children }: PropsWithChildren) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);

  const value = useMemo(
    () => ({
      organization,
      branding,
      settings,
      setOrganization,
      setBranding,
      setSettings,
    }),
    [organization, branding, settings],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const context = useContext(OrganizationContext);

  if (!context) {
    throw new Error('useOrganization must be used within OrganizationProvider');
  }

  return context;
}
