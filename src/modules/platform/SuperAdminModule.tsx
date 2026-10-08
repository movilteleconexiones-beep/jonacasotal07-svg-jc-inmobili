import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../core/auth-context';
import { supabase } from '../../lib/supabase';

interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
}

export function SuperAdminModule() {
  const { user, loading: authLoading, isPlatformAdmin } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!user || !isPlatformAdmin) return;
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('organizations')
      .select('id,name,slug,status,created_at')
      .order('created_at', { ascending: false });
    if (queryError) {
      setOrganizations([]);
      setError('No se pudo consultar las inmobiliarias. Verifica los permisos de lectura del administrador.');
    } else {
      setOrganizations((data ?? []) as OrganizationSummary[]);
    }
    setLoading(false);
  }, [user, isPlatformAdmin]);

  useEffect(() => {
    if (user && isPlatformAdmin) void refresh();
    else setOrganizations([]);
  }, [user, isPlatformAdmin, refresh]);

  if (authLoading) {
    return <main className="min-h-screen bg-slate-50 p-8">Verificando acceso administrativo…</main>;
  }

  if (!user || !isPlatformAdmin) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8">
          <h1 className="text-2xl font-bold">Administración central JCO</h1>
          <p className="mt-3 text-slate-600">Acceso restringido a superadministradores autenticados y activos.</p>
          <a href="/" className="mt-5 inline-block font-semibold text-blue-700 underline">Volver al inicio para iniciar sesión</a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-900 md:p-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sistema Inmobiliario JCO</p>
            <h1 className="text-3xl font-bold">Panel de Superadministrador</h1>
            <p className="mt-2 text-sm text-slate-600">Inmobiliarias registradas · Consulta de solo lectura</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold disabled:opacity-50">Actualizar</button>
            <a href="/" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Volver al inicio</a>
          </div>
        </header>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-600">Inmobiliarias visibles</p>
          <p className="text-3xl font-bold">{organizations.length}</p>
          <p className="mt-2 text-xs text-slate-500">La activación, suspensión y contratación estarán disponibles después de validar sus controles en el servidor.</p>
        </section>
        {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-slate-100"><tr><th className="p-4">Inmobiliaria</th><th className="p-4">Identificador</th><th className="p-4">Estado</th><th className="p-4">Registro</th></tr></thead>
            <tbody>
              {organizations.map((org) => (
                <tr key={org.id} className="border-t border-slate-100">
                  <td className="p-4 font-semibold">{org.name}</td>
                  <td className="p-4">{org.slug}</td>
                  <td className="p-4">{org.status}</td>
                  <td className="p-4">{org.created_at ? new Date(org.created_at).toLocaleDateString('es-CO') : '—'}</td>
                </tr>
              ))}
              {!loading && organizations.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">No hay inmobiliarias disponibles para esta cuenta.</td></tr>}
              {loading && <tr><td colSpan={4} className="p-6 text-center">Cargando inmobiliarias…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

export default SuperAdminModule;
