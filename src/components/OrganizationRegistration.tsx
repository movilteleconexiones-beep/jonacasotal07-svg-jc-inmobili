import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Building2, X } from 'lucide-react';
import { useAuth } from '../core/auth-context';
import { normalizeTenantSlug, isValidTenantSlug, tenantPrivatePath } from '../core/tenant-links';
import { tenantPublicPath } from '../core/public-tenant-route';

/**
 * Creates a pending-payment tenant. Registration never activates a subscription.
 * Database RLS and the verified-payment webhook remain the source of authority.
 */
export function OrganizationRegistration() {
  const { createOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [showUrlOptions, setShowUrlOptions] = useState(false);
  const country = 'CO';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const cleanName = name.trim();
    const cleanSlug = slug.trim().toLowerCase();
    if (cleanName.length < 2 || !isValidTenantSlug(cleanSlug)) {
      setShowUrlOptions(true);
      setError('Escribe el nombre de la inmobiliaria; el enlace generado debe tener de 2 a 60 caracteres.');
      return;
    }

    setBusy(true);
    try {
      const result = await createOrganization(cleanName, cleanSlug, country);
      if (result.error) {
        if (/slug|identificador|duplicad|duplicate|unique|existe|registrado/i.test(result.error)) {
          setShowUrlOptions(true);
        }
        setError('No se pudo completar el registro. Si el enlace ya está ocupado, personalízalo en Opciones de enlace.');
        return;
      }
      // Open the newly created organization's own private panel for plan
      // selection. Public exposure remains gated by verified payment.
      setOpen(false);
      window.location.assign(tenantPrivatePath(cleanSlug));
    } catch {
      setError('No fue posible completar el registro. Intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
        Crear mi inmobiliaria
      </button>
      {open && createPortal(
        <div role="presentation" className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/60 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="create-tenant-title"
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <Building2 aria-hidden="true" className="h-5 w-5" />
                <h2 id="create-tenant-title" className="text-lg font-semibold text-slate-950">Registrar inmobiliaria</h2>
              </div>
              <button type="button" aria-label="Cerrar" disabled={busy} onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Registra tu empresa sin prueba gratuita. Aceptarás los términos y elegirás
              tu plan antes de activar los módulos. La activación requiere pago confirmado.
            </p>
            <form onSubmit={e => void submit(e)} className="mt-5 space-y-4">
              <label className="block text-sm font-medium">Nombre de la inmobiliaria
                <input required minLength={2} maxLength={160} autoComplete="organization"
                  value={name} onChange={e => {
                    setName(e.target.value);
                    if (!slugEdited) setSlug(normalizeTenantSlug(e.target.value));
                  }}
                  className="mt-1 w-full rounded-lg border p-3" />
              </label>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
                <p className="font-semibold text-slate-900">Tu portal se crea automáticamente</p>
                <p className="mt-1 text-slate-600">Tendrá el nombre de tu inmobiliaria y un enlace exclusivo. Podrás añadir el logo, los colores y los inmuebles desde el panel.</p>
                <button type="button" aria-expanded={showUrlOptions} aria-controls="register-tenant-url-options"
                  className="mt-3 text-sm font-semibold text-slate-800 underline underline-offset-4"
                  onClick={() => setShowUrlOptions(open => !open)}>
                  {showUrlOptions ? 'Ocultar opciones de enlace' : 'Opciones de enlace (opcional)'}
                </button>
                {showUrlOptions && (
                  <div id="register-tenant-url-options" className="mt-3 space-y-2">
                    <label className="block font-medium">Enlace personalizado
                      <input minLength={2} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        value={slug} onChange={e => {
                          setSlug(normalizeTenantSlug(e.target.value));
                          setSlugEdited(true);
                        }}
                        aria-label="Enlace público personalizado"
                        placeholder="mi-inmobiliaria" className="mt-1 w-full rounded-lg border bg-white p-3" />
                    </label>
                    {isValidTenantSlug(slug) && <p className="break-all text-xs text-slate-600">
                      {window.location.origin}{tenantPublicPath(slug)}
                    </p>}
                    <p className="text-xs text-slate-600">Es opcional. Si no lo cambias, se genera usando el nombre. El acceso privado siempre requiere iniciar sesión.</p>
                  </div>
                )}
              </div>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <button type="submit" disabled={busy}
                className="w-full rounded-lg bg-slate-900 p-3 font-semibold text-white disabled:opacity-60">
                {busy ? 'Registrando…' : 'Continuar a planes y pago'}
              </button>
            </form>
          </section>
        </div>, document.body,
      )}
    </>
  );
}
