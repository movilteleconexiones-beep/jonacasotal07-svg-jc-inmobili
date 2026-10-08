import { useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Building2, LogIn, LogOut, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useAuth } from '../core/auth-context';
import { DEFAULT_COUNTRY_CODE, LATAM_COUNTRIES } from '../core/countries';

type AuthMode = 'SIGN_IN' | 'SIGN_UP' | 'CREATE_ORG';

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function AuthAccessButton() {
  const {
    configured,
    loading,
    user,
    memberships,
    activeMembership,
    signIn,
    signUp,
    signOut,
    createOrganization,
  } = useAuth();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>('SIGN_IN');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const suggestedSlug = useMemo(
    () => organizationSlug || slugify(organizationName),
    [organizationName, organizationSlug],
  );

  const resetMessage = () => setMessage('');

  const normalizeAuthError = (error: string) => {
    const value = error.toLowerCase();

    if (value.includes('invalid login credentials')) {
      return 'Correo o contraseña incorrectos. Si aún no tienes cuenta, selecciona Registrarse.';
    }

    if (value.includes('user already registered')) {
      return 'Este correo ya está registrado. Intenta iniciar sesión.';
    }

    if (value.includes('password should be at least')) {
      return 'La contraseña debe tener al menos 8 caracteres.';
    }

    return error;
  };

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    resetMessage();
    setBusy(true);

    try {
      if (mode === 'SIGN_UP') {
        const result = await signUp(email.trim(), password, fullName.trim());

        if (result.error) {
          setMessage(normalizeAuthError(result.error));
          return;
        }

        if (result.needsEmailConfirmation) {
          setMessage('Cuenta creada. Revisa tu correo y confirma el acceso antes de iniciar sesión.');
          setMode('SIGN_IN');
          return;
        }

        setMode('CREATE_ORG');
        setMessage('Cuenta creada. Ahora crea tu primera inmobiliaria.');
        return;
      }

      const result = await signIn(email.trim(), password);
      if (result.error) {
        setMessage(normalizeAuthError(result.error));
        return;
      }

      setPassword('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const submitOrganization = async (event: FormEvent) => {
    event.preventDefault();
    resetMessage();

    const slug = slugify(suggestedSlug);
    if (organizationName.trim().length < 2 || !slug) {
      setMessage('Ingresa un nombre válido para la inmobiliaria.');
      return;
    }

    setBusy(true);
    try {
      const result = await createOrganization(organizationName.trim(), slug, countryCode);
      if (result.error) {
        setMessage(result.error);
        return;
      }

      setMessage('Inmobiliaria creada correctamente.');
      setTimeout(() => setOpen(false), 700);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <button type="button" disabled className="px-3 py-2 text-sm text-slate-500">
        Accediendo…
      </button>
    );
  }

  if (user) {
    const needsOrganization = memberships.length === 0;

    return (
      <div className="flex items-center gap-2">
        <div className="hidden lg:block text-right leading-tight">
          <div className="text-xs font-semibold text-slate-900">
            {activeMembership?.organization.name ?? 'Cuenta sin inmobiliaria'}
          </div>
          <div className="text-[11px] text-slate-500">{user.email}</div>
        </div>

        {needsOrganization && (
          <button
            type="button"
            onClick={() => {
              setMode('CREATE_ORG');
              setOpen(true);
              setMessage('');
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Building2 className="h-4 w-4" />
            Crear inmobiliaria
          </button>
        )}

        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
        >
          <LogOut className="h-4 w-4" />
          Salir
        </button>

        {open && mode === 'CREATE_ORG' && (
          <OrganizationModal
            organizationName={organizationName}
            organizationSlug={suggestedSlug}
            setOrganizationName={(value) => {
              setOrganizationName(value);
              if (!organizationSlug) setOrganizationSlug(slugify(value));
            }}
            setOrganizationSlug={setOrganizationSlug}
            countryCode={countryCode}
            setCountryCode={setCountryCode}
            message={message}
            busy={busy}
            onClose={() => setOpen(false)}
            onSubmit={submitOrganization}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMode('SIGN_IN');
          setOpen(true);
          setMessage('');
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-white"
      >
        <LogIn className="h-4 w-4" />
        Acceso
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[9999] grid place-items-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-[2px]">
          <div className="my-auto w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-bold text-slate-950">
                  {mode === 'SIGN_UP' ? 'Crear cuenta' : 'Acceso al sistema'}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {mode === 'SIGN_UP'
                    ? 'Crea la cuenta propietaria de tu inmobiliaria.'
                    : 'Administradores, asesores y clientes ingresan desde la misma plataforma.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!configured ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                La conexión de base de datos todavía no está disponible.
              </div>
            ) : (
              <>
                <div className="mb-5 grid grid-cols-2 rounded-xl border border-stone-200 bg-stone-100 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('SIGN_IN');
                      setMessage('');
                    }}
                    className={
                      'rounded-lg px-3 py-2 text-sm font-semibold ' +
                      (mode === 'SIGN_IN' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600')
                    }
                  >
                    Iniciar sesión
                  </button>
                  <button
  type="button"
  Iniciar sesión
      </button>
    </div>

    <button
      type="button"
      onClick={() => {
        setOpen(false);
        window.location.href = '/super-admin';
      }}
      className="w-full mt-3 px-4 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors shadow-sm"
    >
      <ShieldCheck className="w-4 h-4 text-emerald-400" />
      <span>Módulo Súper Admin</span>
    </button>

    <div className="mt-4">
      <button
        type="button"
        onClick={() => {
          setMode('SIGN_UP');
          setMessage('');
        }}
        /* ... resto de tu botón de registro ... */
  onClick={() => {
    setOpen(false);
    window.location.href = '/super-admin';
  }}
  className="w-full mt-3 px-4 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors shadow-sm"
>
  <ShieldCheck className="w-4 h-4 text-emerald-400" />
  <span>Módulo Súper Admin</span>
  Iniciar sesión
      </button>
    </div>

    <button
      type="button"
      onClick={() => {
        setOpen(false);
        window.location.href = '/super-admin';
      }}
      className="w-full mt-3 px-4 py-2.5 bg-slate-900 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors shadow-sm"
    >
      <ShieldCheck className="w-4 h-4 text-emerald-400" />
      <span>Módulo Súper Admin</span>
    </button>

    <div className="mt-4">
      <button
        type="button"
        onClick={() => {
          setMode('SIGN_UP');
          setMessage('');
        }}
        /* ... resto de tu botón de registro ... */
</button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('SIGN_UP');
                      setMessage('');
                    }}
                    className={
                      'rounded-lg px-3 py-2 text-sm font-semibold ' +
                      (mode === 'SIGN_UP' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600')
                    }
                  >
                    Registrarse
                  </button>
                </div>

                <form onSubmit={submitAuth} className="space-y-4">
                  {mode === 'SIGN_UP' && (
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-slate-700">Nombre completo</span>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        required
                        minLength={3}
                        autoComplete="name"
                        className="w-full rounded-xl border border-stone-300 px-3 py-2.5 outline-none focus:border-slate-500"
                      />
                    </label>
                  )}

                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">Correo</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      autoComplete="email"
                      className="w-full rounded-xl border border-stone-300 px-3 py-2.5 outline-none focus:border-slate-500"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">Contraseña</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                      autoComplete={mode === 'SIGN_UP' ? 'new-password' : 'current-password'}
                      className="w-full rounded-xl border border-stone-300 px-3 py-2.5 outline-none focus:border-slate-500"
                    />
                  </label>

                  {message && (
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-slate-700">
                      {message}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {mode === 'SIGN_UP' ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                    {busy ? 'Procesando…' : mode === 'SIGN_UP' ? 'Registrarme' : 'Iniciar sesión'}
                  </button>

                  <div className="pt-1 text-center text-sm text-slate-600">
                    {mode === 'SIGN_IN' ? (
                      <>
                        ¿No tienes una cuenta?{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setMode('SIGN_UP');
                            setMessage('');
                          }}
                          className="font-semibold text-slate-950 underline underline-offset-4"
                        >
                          Regístrate
                        </button>
                      </>
                    ) : (
                      <>
                        ¿Ya tienes una cuenta?{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setMode('SIGN_IN');
                            setMessage('');
                          }}
                          className="font-semibold text-slate-950 underline underline-offset-4"
                        >
                          Inicia sesión
                        </button>
                      </>
                    )}
                  </div>
                </form>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

interface OrganizationModalProps {
  organizationName: string;
  organizationSlug: string;
  setOrganizationName: (value: string) => void;
  setOrganizationSlug: (value: string) => void;
  countryCode: string;
  setCountryCode: (value: string) => void;
  message: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}

function OrganizationModal({
  organizationName,
  organizationSlug,
  setOrganizationName,
  setOrganizationSlug,
  countryCode,
  setCountryCode,
  message,
  busy,
  onClose,
  onSubmit,
}: OrganizationModalProps) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] grid place-items-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-[2px]">
      <div className="my-auto w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Building2 className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-950">Crear inmobiliaria</h2>
            <p className="mt-1 text-sm text-slate-600">
              Se crearán automáticamente los roles Propietario, Administrador, Coordinador, Asesor y Cliente.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Nombre de la inmobiliaria</span>
            <input
              type="text"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              required
              minLength={2}
              className="w-full rounded-xl border border-stone-300 px-3 py-2.5 outline-none focus:border-slate-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Identificador</span>
            <input
              type="text"
              value={organizationSlug}
              onChange={(event) => setOrganizationSlug(slugify(event.target.value))}
              required
              className="w-full rounded-xl border border-stone-300 px-3 py-2.5 font-mono text-sm outline-none focus:border-slate-500"
            />
          </label>

          {message && (
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-slate-700">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? 'Creando inmobiliaria…' : 'Crear inmobiliaria'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
