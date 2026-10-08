import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { LogIn, LogOut, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useAuth } from '../core/auth-context';

type AuthMode = 'SIGN_IN' | 'SIGN_UP';

export function AuthAccessButton() {
  const {
    configured,
    loading,
    user,
    memberships,
    activeMembership,
    isPlatformAdmin,
    accessError,
    signIn,
    signUp,
    signOut,
    refreshMemberships,
  } = useAuth();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>('SIGN_IN');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshingAccess, setRefreshingAccess] = useState(false);

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

        setMode('SIGN_IN');
        setMessage('Cuenta creada. El acceso a una inmobiliaria requiere invitación o autorización de la plataforma.');
        return;
      }

      const result = await signIn(email.trim(), password);
      if (result.error) {
        setMessage(normalizeAuthError(result.error));
        return;
      }

      setPassword('');
      setOpen(false);
    } catch (error) {
      console.error('Authentication request failed', error);
      setMessage('No fue posible completar el acceso. Verifica tu conexión e inténtalo nuevamente.');
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
            {isPlatformAdmin ? 'Administración central JCO' : activeMembership?.organization.name ?? 'Cuenta sin inmobiliaria'}
          </div>
          <div className="text-[11px] text-slate-500">{user.email}</div>
        </div>

        {accessError && (
          <span className="max-w-xs text-xs text-red-700" role="alert">{accessError}</span>
        )}

        {needsOrganization && !isPlatformAdmin && !accessError && (
          <div className="flex max-w-xs flex-wrap items-center gap-2" role="status">
            <span className="text-xs text-amber-800">No hay una membresía activa. Si ya recibiste una invitación, actualiza el acceso.</span>
            <button type="button" disabled={refreshingAccess} onClick={async () => {
              setRefreshingAccess(true);
              try { await refreshMemberships(); } catch (error) { console.warn('Unable to refresh tenant access', error); } finally { setRefreshingAccess(false); }
            }} className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-50 disabled:opacity-50">
              {refreshingAccess ? 'Actualizando…' : 'Actualizar acceso'}
            </button>
          </div>
        )}

        {isPlatformAdmin && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"><ShieldCheck className="h-4 w-4" /> Superadministrador</span>
        )}

        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
        >
          <LogOut className="h-4 w-4" />
          Salir
        </button>


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
                    ? 'Registra tu usuario. Una inmobiliaria debe ser autorizada por la administración de JCO.'
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

