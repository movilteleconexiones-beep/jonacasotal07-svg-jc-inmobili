import { useState, type FormEvent } from 'react';
import { LogIn, LogOut, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../core/auth-context';

export function AuthAccessButton() {
  const { configured, loading, user, activeMembership, signIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const result = await signIn(email.trim(), password);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPassword('');
    setOpen(false);
  };

  if (loading) {
    return (
      <button type="button" disabled className="px-3 py-2 text-sm text-slate-500">
        Accediendo…
      </button>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden lg:block text-right leading-tight">
          <div className="text-xs font-semibold text-slate-900">
            {activeMembership?.organization.name ?? 'Cuenta'}
          </div>
          <div className="text-[11px] text-slate-500">{user.email}</div>
        </div>
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
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-white"
      >
        <LogIn className="h-4 w-4" />
        Acceso
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-bold text-slate-950">Acceso al sistema</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Administradores, asesores y clientes ingresan desde la misma cuenta segura.
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
                La interfaz de acceso ya está instalada. Falta conectar las variables de Supabase para activar cuentas reales.
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
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
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-stone-300 px-3 py-2.5 outline-none focus:border-slate-500"
                  />
                </label>
                {error && <p className="text-sm text-red-700">{error}</p>}
                <button
                  type="submit"
                  className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800"
                >
                  Iniciar sesión
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
