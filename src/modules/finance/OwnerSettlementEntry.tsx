import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { parseMoneyInput } from '../../core/rent-owner-money';
import { commissionValueFromRate, parseCommissionPercentage } from '../../core/commission-percentage';
import { localMonthISO } from '../../core/local-calendar';
import { supabase } from '../../lib/supabase';

interface Lease {id:string;owner_id:string|null;contract_number:string|null;status:string}
interface ReceiptPeriod {lease_id:string;period_month:string;paid_amount:number;status:string}
const moneyInputClass='mt-1 w-full rounded-lg border border-stone-300 px-3 py-2';
function nonNegative(value:FormDataEntryValue|null){
  return parseMoneyInput(value, true);
}
export function OwnerSettlementEntry({organizationId}:{organizationId:string}){
  const {can}=useAuth();
  const permitted=can(PERMISSIONS.OWNER_STATEMENTS_CREATE) && can(PERMISSIONS.RENT_PAYMENTS_VIEW);
  const [leases,setLeases]=useState<Lease[]>([]);
  const [payments,setPayments]=useState<ReceiptPeriod[]>([]);
  const [leaseId,setLeaseId]=useState('');
  const [period,setPeriod]=useState(localMonthISO());
  const [commissionRate,setCommissionRate]=useState('0');
  const [taxes,setTaxes]=useState('0');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    setLeases([]);setPayments([]);setLeaseId('');setMessage('');setLoading(true);
    void(async()=>{
      try {
        const [l,p]=await Promise.all([
          supabase.from('leases').select('id,owner_id,contract_number,status').eq('organization_id',organizationId).limit(501),
          supabase.from('rent_payments').select('lease_id,period_month,paid_amount,status').eq('organization_id',organizationId).limit(501),
        ]);
        if(cancelled)return;
        if(l.error||p.error||(l.data?.length??0)>500||(p.data?.length??0)>500)
          setMessage('No se pudieron consultar todos los contratos y pagos de esta inmobiliaria.');
        else {
          setLeases((l.data??[]) as Lease[]);
          setPayments((p.data??[]) as ReceiptPeriod[]);
        }
      } catch {
        if(!cancelled) setMessage('Falló la conexión al consultar contratos y pagos. Reintenta ingresar al módulo.');
      } finally {
        if(!cancelled) setLoading(false);
      }
    })();
    return()=>{cancelled=true;};
  },[organizationId,revision]);

  const available=leases.filter(x=>x.owner_id&&['ACTIVE','RENEWAL','FINISHED'].includes(x.status));
  const gross=payments.filter(x=>x.lease_id===leaseId&&String(x.period_month).slice(0,7)===period&&x.status!=='CANCELLED')
    .reduce((sum,p)=>sum+Number(p.paid_amount||0),0);
  const commissionPercentage=parseCommissionPercentage(commissionRate);
  const commissionNumber=commissionValueFromRate(gross,commissionPercentage);
  const taxNumber=nonNegative(taxes);
  const totalDeduction=commissionNumber+taxNumber;
  const net=Number.isFinite(totalDeduction)?gross-totalDeduction:NaN;
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!permitted||busy||!organizationId)return;
    const selected=available.find(x=>x.id===leaseId);
    if(!selected?.owner_id||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||
       !Number.isFinite(gross)||gross<0||!Number.isFinite(commissionPercentage)||!Number.isFinite(net)||net<0){
      setMessage('Revisa los pagos recaudados y las deducciones: el neto no puede ser negativo.');return;
    }
    if(!window.confirm('Crear liquidación en BORRADOR. Los valores no representan un giro al propietario. ¿Confirmas?'))return;
    setBusy(true);setMessage('');
    try {
      const {error}=await supabase.rpc('create_owner_draft_statement_by_percentage',{
        target_org:organizationId,target_lease:selected.id,target_month:period+'-01',
        agency_commission_percentage:commissionPercentage,withholding_tax:taxNumber,
      });
      if(error){setMessage('No se pudo guardar la liquidación: '+error.message);return;}
      setMessage('Liquidación creada en borrador. Puedes registrar sus deducciones individuales con soporte antes de aprobarla.');
      window.dispatchEvent(new Event('owner-statement-updated'));setRevision(n=>n+1);
    } catch {
      setMessage('No se confirmó la creación de la liquidación. Consulta los registros antes de reintentar para evitar duplicados.');
      setRevision(n=>n+1);
    } finally {
      setBusy(false);
    }
  }
  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
    <div><h2 className="text-lg font-bold">Crear liquidación del propietario</h2>
      <p className="text-sm text-slate-600">Calcula el ingreso bruto con pagos registrados, separa comisión e impuestos y deja el extracto en borrador. No transfiere dinero.</p></div>
    {loading?<p role="status">Cargando contratos…</p>:
      <form onSubmit={e=>void save(e)} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Contrato vinculado con propietario<select name="lease_id" required value={leaseId}
          onChange={e=>setLeaseId(e.target.value)} className={moneyInputClass}><option value="">Seleccionar contrato</option>
          {available.map(x=><option value={x.id} key={x.id}>{x.contract_number||x.id}</option>)}</select></label>
        <label className="text-sm">Mes de liquidación<input type="month" required value={period}
          onChange={e=>setPeriod(e.target.value)} className={moneyInputClass}/></label>
        <label className="text-sm">Ingreso registrado por pagos de inquilinos (COP)
          <output className="mt-1 block rounded-lg border bg-stone-50 px-3 py-2 font-semibold">{gross.toLocaleString('es-CO')}</output></label>
        <label className="text-sm">Comisión inmobiliaria (%)<input type="number" min="0" max="100" step="0.01" required
          value={commissionRate} onChange={e=>setCommissionRate(e.target.value)} className={moneyInputClass}/>
          <span className="mt-1 block text-xs text-slate-600">
            Comisión calculada (COP): {Number.isFinite(commissionNumber)
              ?commissionNumber.toLocaleString('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2})
              :'Verifica el porcentaje (0-100 %)'}. Base: ingreso efectivamente registrado.
          </span>
        </label>
        <label className="text-sm">Impuestos / retenciones (COP)<input type="number" min="0" step="0.01" required
          value={taxes} onChange={e=>setTaxes(e.target.value)} className={moneyInputClass}/></label>
        <label className="text-sm">Neto provisional (antes de otros gastos)
          <output className="mt-1 block rounded-lg border bg-stone-50 px-3 py-2 font-bold">{Number.isFinite(net)?net.toLocaleString('es-CO'):'Verificar cifras'}</output></label>
        {!available.length&&<p className="md:col-span-2 text-sm text-amber-800">
          Registra primero un propietario, un contrato vinculado y los pagos del período. No hay contratos aptos para liquidar.
        </p>}
        <p className="md:col-span-2 text-xs text-slate-600">
          La comisión se introduce como porcentaje y el valor en COP se calcula en el servidor.
          Los extractos anteriores conservan sus importes originales. Agua, gas, energía, administración, mantenimiento y otros gastos se registrarán individualmente en el libro de deducciones, con quién asume cada uno y soporte. No se descuentan automáticamente al inquilino.
        </p>
        <div className="md:col-span-2"><button type="submit" disabled={!permitted||busy||!available.length||!leaseId||!Number.isFinite(net)||net<0}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Guardar liquidación en borrador</button></div>
      </form>}
    {message&&<p role="status" className="text-sm text-amber-900">{message}</p>}
  </section>;
}
