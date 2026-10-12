import { useEffect, useState } from 'react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';

interface Lease {
  id: string;
  tenant_id: string | null;
  contract_number: string | null;
  monthly_rent: number;
  status: string;
}
interface RentPayment {
  id: string;
  lease_id: string;
  period_month: string;
  expected_amount: number;
  paid_amount: number;
  status: string;
}
interface OwnerStatement {
  id: string;
  owner_id: string | null;
  lease_id: string;
  period_month: string;
  gross_income: number;
  commission_amount: number;
  tax_amount: number;
  other_deductions: number;
  net_amount: number;
  status: string;
}
interface Identity { id: string; first_name: string; last_name: string | null }

const cop = (value: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(value);
const amount = (value: number | string | null | undefined) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 100)) ? n : NaN;
};
const fullName = (person: Identity | undefined) =>
  person ? [person.first_name, person.last_name].filter(Boolean).join(' ') : 'Sin nombre disponible';

export function rentalBalance(expected: number, paid: number): number {
  return Math.max(0, amount(expected) - amount(paid));
}
export function ownerNetFromDeductions(statement: Pick<OwnerStatement,
  'gross_income' | 'commission_amount' | 'tax_amount' | 'other_deductions'>): number {
  return amount(statement.gross_income) - amount(statement.commission_amount) -
    amount(statement.tax_amount) - amount(statement.other_deductions);
}

/** Read-only tenant obligations. An unregistered payment period is NOT a confirmed debt. */
export function TenantRentBalanceSummary({ organizationId }: { organizationId: string }) {
  const { can } = useAuth();
  const allowed = can(PERMISSIONS.RENT_PAYMENTS_VIEW) && can(PERMISSIONS.LEASES_VIEW);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [payments, setPayments] = useState<RentPayment[]>([]);
  const [contacts, setContacts] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLeases([]); setPayments([]); setContacts([]); setError('');
    if (!allowed || !organizationId) { setLoading(false); return () => { cancelled = true; }; }
    setLoading(true);
    void (async () => {
      try {
        const [leaseResult, paymentResult, contactResult] = await Promise.all([
          supabase.from('leases').select('id,tenant_id,contract_number,monthly_rent,status').eq('organization_id', organizationId),
          supabase.from('rent_payments').select('id,lease_id,period_month,expected_amount,paid_amount,status').eq('organization_id', organizationId).order('period_month', { ascending: false }).limit(100),
          supabase.from('contacts').select('id,first_name,last_name').eq('organization_id', organizationId),
        ]);
        if (cancelled) return;
        if (leaseResult.error || paymentResult.error || contactResult.error) {
          setError('No se pudieron consultar los cánones y pagos de arriendo. Comprueba tus permisos.');
        } else {
          setLeases((leaseResult.data ?? []) as Lease[]);
          setPayments((paymentResult.data ?? []) as RentPayment[]);
          setContacts((contactResult.data ?? []) as Identity[]);
        }
      } catch {
        if (!cancelled) setError('No fue posible cargar las obligaciones de arriendo.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [organizationId, allowed]);

  if (!allowed) return null;
  const byLease = new Map(leases.map(item => [item.id, item]));
  const byContact = new Map(contacts.map(item => [item.id, item]));
  return <section className="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Arriendos de clientes">
    <h2 className="text-lg font-bold">Cánones y pagos de los inquilinos</h2>
    <p className="mt-1 text-sm text-slate-600">Lo que debe pagar cada inquilino a la inmobiliaria. Solo se consideran saldos de períodos registrados, no deudas inferidas.</p>
    {loading ? <p role="status" className="mt-4 text-sm">Cargando información de arriendos…</p> :
      error ? <p role="alert" className="mt-4 text-sm text-amber-900">{error}</p> :
      <>
        {leases.length > 0 && <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b text-slate-600"><th className="py-2">Inquilino</th><th className="py-2">Contrato</th><th className="py-2 text-right">Canon mensual</th><th className="py-2">Estado</th></tr></thead>
            <tbody>{leases.map(lease => <tr key={lease.id} className="border-b border-stone-100">
              <td className="py-2">{lease.tenant_id ? fullName(byContact.get(lease.tenant_id)) : 'Sin inquilino asignado'}</td>
              <td className="py-2">{lease.contract_number || '—'}</td>
              <td className="py-2 text-right">{cop(amount(lease.monthly_rent))}</td>
              <td className="py-2">{lease.status}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        <h3 className="mt-5 font-semibold">Obligaciones mensuales registradas</h3>
        {payments.length === 0 ? <p className="mt-2 text-sm text-slate-500">Todavía no hay períodos de pago registrados; no se puede calcular cartera vencida.</p> :
          <div className="mt-2 overflow-x-auto"><table className="min-w-full text-left text-sm">
            <thead><tr className="border-b text-slate-600"><th className="py-2">Inquilino / Período</th><th className="py-2 text-right">A pagar</th><th className="py-2 text-right">Registrado como pagado</th><th className="py-2 text-right">Saldo pendiente</th><th className="py-2">Estado</th></tr></thead>
            <tbody>{payments.map(payment => {
              const lease = byLease.get(payment.lease_id);
              const valid = lease && Number.isFinite(rentalBalance(payment.expected_amount, payment.paid_amount));
              return <tr key={payment.id} className="border-b border-stone-100">
                <td className="py-2">{lease?.tenant_id ? fullName(byContact.get(lease.tenant_id)) : 'Contrato no disponible'}<div className="text-xs text-slate-500">{payment.period_month}</div></td>
                <td className="py-2 text-right">{cop(amount(payment.expected_amount))}</td>
                <td className="py-2 text-right">{cop(amount(payment.paid_amount))}</td>
                <td className="py-2 text-right font-semibold">{valid ? cop(rentalBalance(payment.expected_amount, payment.paid_amount)) : 'Por verificar'}</td>
                <td className="py-2">{payment.status}</td>
              </tr>;
            })}</tbody>
          </table></div>}
        {payments.length === 100 && <p className="mt-2 text-xs text-amber-800">Mostrando hasta 100 períodos recientes; no es un reporte histórico completo.</p>}
      </>}
  </section>;
}

/** Read-only owner liquidation. Statement status is NOT proof of a bank transfer. */
export function OwnerNetStatementsSummary({ organizationId }: { organizationId: string }) {
  const { can } = useAuth();
  const allowed = can(PERMISSIONS.OWNER_STATEMENTS_VIEW);
  const [statements, setStatements] = useState<OwnerStatement[]>([]);
  const [owners, setOwners] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatements([]); setOwners([]); setError('');
    if (!allowed || !organizationId) { setLoading(false); return () => { cancelled = true; }; }
    setLoading(true);
    void (async () => {
      try {
        const [statementResult, ownerResult] = await Promise.all([
          supabase.from('owner_statements')
            .select('id,owner_id,lease_id,period_month,gross_income,commission_amount,tax_amount,other_deductions,net_amount,status')
            .eq('organization_id', organizationId).order('period_month', { ascending: false }).limit(100),
          supabase.from('property_owners').select('id,first_name,last_name').eq('organization_id', organizationId),
        ]);
        if (cancelled) return;
        if (statementResult.error || ownerResult.error) {
          setError('No se pudieron consultar las liquidaciones de los propietarios. Comprueba tus permisos.');
        } else {
          setStatements((statementResult.data ?? []) as OwnerStatement[]);
          setOwners((ownerResult.data ?? []) as Identity[]);
        }
      } catch {
        if (!cancelled) setError('No fue posible cargar las liquidaciones.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [organizationId, allowed]);

  if (!allowed) return null;
  const byOwner = new Map(owners.map(item => [item.id, item]));
  return <section className="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Liquidaciones de propietarios">
    <h2 className="text-lg font-bold">Liquidación del propietario</h2>
    <p className="mt-1 text-sm text-slate-600">Valor neto por entregar después de comisiones, impuestos y otras deducciones. Los servicios públicos y demás conceptos aún están agrupados en «Otras deducciones».</p>
    {loading ? <p role="status" className="mt-4 text-sm">Cargando liquidaciones…</p> :
      error ? <p role="alert" className="mt-4 text-sm text-amber-900">{error}</p> :
      statements.length === 0 ? <p className="mt-4 text-sm text-slate-500">Aún no hay liquidaciones generadas. No se puede establecer un neto a pagar.</p> :
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead><tr className="border-b text-slate-600">
            <th className="py-2">Propietario / Mes</th>
            <th className="py-2 text-right">Bruto</th><th className="py-2 text-right">Comisión</th>
            <th className="py-2 text-right">Impuestos</th><th className="py-2 text-right">Otras deducciones</th>
            <th className="py-2 text-right">Neto a entregar</th><th className="py-2">Estado</th>
          </tr></thead>
          <tbody>{statements.map(statement => {
            const calculated = ownerNetFromDeductions(statement);
            const reconciled = Number.isFinite(calculated) && Math.abs(calculated - amount(statement.net_amount)) < 0.01;
            return <tr key={statement.id} className="border-b border-stone-100">
              <td className="py-2">{statement.owner_id ? fullName(byOwner.get(statement.owner_id)) : 'Propietario no asignado'}<div className="text-xs text-slate-500">{statement.period_month}</div></td>
              <td className="py-2 text-right">{cop(amount(statement.gross_income))}</td>
              <td className="py-2 text-right">{cop(amount(statement.commission_amount))}</td>
              <td className="py-2 text-right">{cop(amount(statement.tax_amount))}</td>
              <td className="py-2 text-right">{cop(amount(statement.other_deductions))}</td>
              <td className="py-2 text-right font-semibold">{reconciled ? cop(amount(statement.net_amount)) : 'Por conciliar'}</td>
              <td className="py-2">{statement.status}{!reconciled && <div className="text-xs text-amber-800">Diferencia en liquidación</div>}</td>
            </tr>;
          })}</tbody>
        </table>
        <p className="mt-2 text-xs text-slate-600">El estado registrado no confirma por sí solo una transferencia bancaria al propietario.</p>
        {statements.length === 100 && <p className="mt-2 text-xs text-amber-800">Mostrando hasta 100 liquidaciones recientes.</p>}
      </div>}
  </section>;
}
