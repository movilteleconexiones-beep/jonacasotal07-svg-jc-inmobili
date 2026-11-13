import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { OrganizationSummary } from '../../core/platform-overview';

interface PlatformMember {
  member_id: string;
  user_id: string;
  display_name: string;
  member_status: string;
  joined_at: string | null;
  assigned_roles: string[];
  is_protected: boolean;
}

const PAGE_SIZE = 50;

export function PlatformMembers({ organization, onChanged }: {
  organization: OrganizationSummary;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<PlatformMember[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [workingOn, setWorkingOn] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestId = useRef(0);

  const loadPage = useCallback(async (orgId: string, offset: number, append: boolean) => {
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('platform_get_organization_members', {
      target_org: orgId,
      page_limit: PAGE_SIZE,
      page_offset: offset,
    });
    if (request !== requestId.current) return;
    if (rpcError) {
      setError('No se pudieron obtener los miembros. Verifica que el acceso central esté autorizado.');
    } else {
      const page = (data ?? []) as PlatformMember[];
      setMembers(previous => append ? [...previous, ...page] : page);
      setNextOffset(offset + page.length);
      setHasMore(page.length === PAGE_SIZE);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setMembers([]);
    setNextOffset(0);
    setHasMore(false);
    setMessage('');
    void loadPage(organization.organization_id, 0, false);
    return () => { requestId.current++; };
  }, [organization.organization_id, loadPage]);

  async function changeStatus(member: PlatformMember) {
    if (member.is_protected || workingOn || loading) return;
    const nextStatus = member.member_status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const confirmation = nextStatus === 'SUSPENDED' ? 'SUSPENDER' : 'REACTIVAR';
    if (window.prompt(`Confirma ${confirmation} a ${member.display_name} en ${organization.organization_name}. Escribe ${confirmation}.`) !== confirmation) return;
    const reason = window.prompt('Motivo de auditoría obligatorio (10 a 500 caracteres).');
    if (!reason || reason.trim().length < 10 || reason.trim().length > 500) {
      setError('No se realizó el cambio: el motivo debe contener entre 10 y 500 caracteres.');
      return;
    }
    setWorkingOn(member.member_id);
    setError('');
    setMessage('');
    try {
      const { error: updateError } = await supabase.rpc('platform_set_organization_member_status', {
        target_org: organization.organization_id,
        target_member: member.member_id,
        target_status: nextStatus,
        reason: reason.trim(),
      });
      if (updateError) throw updateError;
      await loadPage(organization.organization_id, 0, false);
      setMessage('Estado actualizado y registrado en auditoría; no se eliminaron datos históricos.');
      onChanged();
    } catch {
      setError('No se pudo actualizar la membresía. Verifica el rol, las protecciones y los límites del plan.');
    } finally {
      setWorkingOn(null);
    }
  }

  return (
    <section id="miembros-plataforma" className="mt-6 rounded-xl border bg-white p-5" aria-label="Miembros de la inmobiliaria seleccionada">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Miembros · {organization.organization_name}</h2>
          <p className="mt-1 text-sm text-slate-600">Gestión central auditada. Los SuperAdmins y el último propietario activo están protegidos.</p>
        </div>
        <button type="button" onClick={() => void loadPage(organization.organization_id, 0, false)}
          disabled={loading || workingOn !== null} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">Actualizar miembros</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-800" role="alert">{error}</p>}
      {message && <p className="mt-3 text-sm text-emerald-800" role="status">{message}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead className="bg-slate-100"><tr><th className="p-3">Usuario</th><th className="p-3">Roles</th>
            <th className="p-3">Estado</th><th className="p-3">Acción</th></tr></thead>
          <tbody>
            {members.map(member => <tr key={member.member_id} className="border-t">
              <td className="p-3"><div className="font-semibold">{member.display_name}</div>
                <span className="font-mono text-xs text-slate-500" title={member.user_id}>{member.user_id.slice(0, 8)}…</span></td>
              <td className="p-3">{member.assigned_roles.length ? member.assigned_roles.join(', ') : 'Sin roles activos'}</td>
              <td className="p-3">{member.member_status === 'ACTIVE' ? 'Activo' : member.member_status === 'SUSPENDED' ? 'Suspendido' : 'Inactivo'}</td>
              <td className="p-3">
                {member.is_protected ? <span className="text-slate-500">Protegido</span> :
                  <button type="button" onClick={() => void changeStatus(member)}
                    disabled={loading || workingOn !== null}
                    className="rounded-md border px-3 py-1 font-medium disabled:opacity-50">
                    {workingOn === member.member_id ? 'Aplicando…' : member.member_status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
                  </button>}
              </td>
            </tr>)}
            {!loading && members.length === 0 && <tr><td colSpan={4} className="p-4 text-slate-500">No se encontraron miembros.</td></tr>}
          </tbody>
        </table>
      </div>
      {loading && <p className="mt-3 text-sm text-slate-500">Consultando miembros…</p>}
      {hasMore && <button type="button" className="mt-3 rounded-lg border px-3 py-2 text-sm font-semibold"
        onClick={() => void loadPage(organization.organization_id, nextOffset, true)}
        disabled={loading || workingOn !== null}>Mostrar más miembros</button>}
    </section>
  );
}
