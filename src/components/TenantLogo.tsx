import { useState } from 'react';
import { Building2 } from 'lucide-react';

interface TenantLogoProps {
  src?: string | null;
  organizationName: string;
}

/**
 * In the private workspace an obsolete or inaccessible branded image must
 * never render as a broken-image icon. The fallback is scoped to this tenant.
 * When src changes (including switching organizations), retry the new URL.
 */
export function TenantLogo({ src, organizationName }: TenantLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const usableSrc = src?.trim() || null;

  if (!usableSrc || usableSrc === failedSrc) {
    return (
      <span role="img" aria-label={`Logotipo no disponible de ${organizationName}`}>
        <Building2 className="h-7 w-7 text-slate-500" aria-hidden="true" />
      </span>
    );
  }

  return (
    <img
      src={usableSrc}
      alt={`Logo de ${organizationName}`}
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(usableSrc)}
      className="max-h-full max-w-full object-contain p-1.5"
    />
  );
}
