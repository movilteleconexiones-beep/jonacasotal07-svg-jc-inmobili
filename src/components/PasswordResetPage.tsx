import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../core/auth-context';
import { supabase } from '../lib/supabase';
import { PASSWORD_RESET_PATH, validateNewPassword } from '../core/password-recovery';

/**
 * Only an authenticated Supabase session (normally issued by a valid recovery
 * link) can update a password. Never trust URL parameters as authorization.
 * The screen is deliberately outside tenant routing; no membership is required.
 */
export function PasswordResetPage() {
  const { session, loading } = useAuth();
  const [phase, setPhase] = useState<'checking' | 'invalid' | 'ready' | 'done'>('checking');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || phase === 'done') return;
    if (!session) {
      setPhase('invalid');
      return;
    }
    let mounted = true;
    setPhase('checking');
    // getUser checks the access token with Supabase Auth; getSession alone only
    // reads local storage and is not sufficient evidence of a valid identity.
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error || !data.user) {
        setPhase('invalid');
        return;
      }
      setAccount(data.user.email || 'cuenta autenticada');
      // Remove any consumed PKCE/hash callback details from browser history.
      if (window.location.search || window.location.hash) {
        window.history.replaceState(window.history.state, '', PASSWORD_RESET_PATH);
      }
      setPhase('ready');
    }).catch(() => { if (mounted) setPhase('invalid'); });
    return () => { mounted = false; };
  }, [loading, session?.access_token, phase === 'done']);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || phase !== 'ready') return;
    const validation = validateNewPassword(password, confirmation);
    if (validation) {
      setErrorMessage(validation);
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMessage('No fue posible cambiar la contraseña. Solicita un enlace nuevo e inténtalo nuevamente.');
        return;
      }
      setPassword('');
      setConfirmation('');
      // Force a fresh sign-in; password reset must not silently open a tenant
      // workspace after changing credentials.
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setErrorMessage('Contraseña actualizada, pero no se pudo cerrar la sesión. Cierra sesión manualmente antes de continuar.');
        return;
      }
      setPhase('done');
    } catch {
      setErrorMessage('No fue posible completar el cambio. Comprueba tu conexión e inténtalo nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-stone-100 p-4 text-slate-900">
      <section className="w-full max-w-md space-y-5 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm" aria-labelledby="password-reset-title">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white"><KeyRound aria-hidden="true" /></div>
        <h1 id="password-reset-title" className="text-2xl font-bold">Restablecer contraseña</h1>
        {phase === 'checking' && <p role="status" className="text-sm text-slate-600">Verificando el enlace de recuperación…</p>}
        {phase === 'invalid' && (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-slate-700">El enlace ha vencido, ya se utilizó o no es válido. Solicita otro desde «Acceso» en la portada.</p>
            <a className="inline-block rounded-lg border px-4 py-2 text-sm font-semibold" href="/">Volver al inicio</a>
          </div>
        )}
        {phase === 'done' && (
          <div role="status" className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-green-800"><ShieldCheck aria-hidden="true" /> Contraseña actualizada correctamente.</p>
            <p className="text-sm text-slate-600">Inicia sesión nuevamente con tu nueva contraseña.</p>
            <a className="inline-block rounded-lg border px-4 py-2 text-sm font-semibold" href="/">Ir a iniciar sesión</a>
          </div>
        )}
        {phase === 'ready' && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-slate-600">Establece una contraseña nueva para <strong>{account}</strong>.</p>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Nueva contraseña</span>
              <input type="password" required minLength={12} maxLength={72} autoComplete="new-password"
                value={password} onChange={event => setPassword(event.target.value)}
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 focus:border-slate-600" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Confirmar nueva contraseña</span>
              <input type="password" required minLength={12} maxLength={72} autoComplete="new-password"
                value={confirmation} onChange={event => setConfirmation(event.target.value)}
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 focus:border-slate-600" />
            </label>
            {errorMessage && <p role="alert" className="text-sm text-red-700">{errorMessage}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-60">
              {busy ? 'Actualizando…' : 'Guardar nueva contraseña'}
            </button>
          </form>
        )}
        <p className="text-xs text-slate-500">Sistema Inmobiliario JCO · No compartas tu enlace ni tus códigos de recuperación.</p>
      </section>
    </main>
  );
}
