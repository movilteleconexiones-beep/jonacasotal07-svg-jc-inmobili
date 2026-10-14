import { useEffect, useState, type FormEvent } from 'react';
import { PERMISSIONS } from '../../core/permissions';
import { useAuth } from '../../core/auth-context';
import { supabase } from '../../lib/supabase';

interface ActiveLease {
  id: string;
  property_id: string;
  contract_number: string | null;
  start_date: string;
  status: string;
}
interface PropertyLabel { id: string; code: string; title: string; }

const todayColombia=()=>new Intl.DateTimeFormat('sv-SE',{
  timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date());

/** Administrative close, not an accounting reversal or physical inventory deletion. */
export function RentalContractClosure({organizationId,onFinished}:{
  organizationId:string;onFinished?:(propertyId:string)=>void;
}) {
  const {can,activeMembership}=useAuth();
  const administrator=activeMembership?.roles.some(role=>role.key==='ADMIN')??false;
  const authorized=administrator&&can(PERMISSIONS.LEASES_EDIT)&&can(PERMISSIONS.PROPERTIES_EDIT);
  const [leases,setLeases]=useState<ActiveLease[]>([]);
  const [properties,setProperties]=useState<PropertyLabel[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [endDate,setEndDate]=useState(todayColombia);
  const [reason,setReason]=useState('');
  const [handover,setHandover]=useState(false);
  const [ackFinancials,setAckFinancials]=useState(false);
  const [pending,setPending]=useState<{rent:number;owner:number}|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [revision,setRevision]=useState(0);

  useEffect(()=>{
    let cancelled=false;setLoading(true);setLeases([]);setProperties([]);setSelectedId('');setPending(null);setError('');
    if(!authorized){setLoading(false);return;}
    void (async()=>{
      try {
        const [l,p]=await Promise.all([
          supabase.from('leases')
            .select('id,property_id,contract_number,start_date,status',{count:'exact'})
            .eq('organization_id',organizationId).in('status',['ACTIVE','RENEWAL'])
            .order('start_date',{ascending:false}).limit(501),
          supabase.from('properties').select('id,code,title',{count:'exact'})
            .eq('organization_id',organizationId).limit(501),
        ]);
        if(cancelled)return;
        if(l.error||p.error||l.count==null||p.count==null||
          l.count>(l.data??[]).length||p.count>(p.data??[]).length||
          (l.data??[]).length>500||(p.data??[]).length>500)
          throw new Error('No se pudo comprobar la lista completa. Intenta actualizar.');
        setLeases(l.data??[]);setProperties(p.data??[]);
      }catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:'No se pudo consultar contratos.');}
      finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[organizationId,authorized,revision]);

  useEffect(()=>{
    let cancelled=false;setPending(null);
    if(!selectedId||!authorized)return;
    void (async()=>{
      try {
        const [r,s]=await Promise.all([
          supabase.from('rent_payments').select('expected_amount,paid_amount,status',{count:'exact'})
            .eq('organization_id',organizationId).eq('lease_id',selectedId).limit(501),
          supabase.from('owner_statements').select('id',{count:'exact',head:true})
            .eq('organization_id',organizationId).eq('lease_id',selectedId).neq('status','PAID'),
        ]);
        if(cancelled)return;
        if(r.error||s.error||r.count==null||s.count==null||(r.data??[]).length<r.count)
          throw new Error('No se pudieron verificar los registros financieros de este contrato.');
        setPending({
          rent:(r.data??[]).filter(row=>row.status!=='CANCELLED'&&Number(row.expected_amount)>Number(row.paid_amount)).length,
          owner:s.count,
        });
      }catch(cause){if(!cancelled){setError(cause instanceof Error?cause.message:'No se pudo comprobar saldos.');setPending(null);}}
    })();
    return()=>{cancelled=true;};
  },[organizationId,authorized,selectedId]);

  async function finish(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!authorized||busy||!selectedId||!handover||reason.trim().length<12||!pending||!endDate) return;
    const lease=leases.find(item=>item.id===selectedId);
    if(!lease||endDate<lease.start_date||endDate>todayColombia()){setError('Comprueba la fecha efectiva de entrega.');return;}
    if((pending.rent>0||pending.owner>0)&&!ackFinancials){
      setError('Reconoce expresamente los pendientes contables antes de continuar.');return;
    }
    if(!window.confirm('¿Confirmas la entrega física y la finalización definitiva del contrato? Los pagos y soportes históricos se conservarán.'))return;
    setBusy(true);setError('');setNotice('');
    try{
      const {data,error:failure}=await supabase.rpc('admin_finish_lease_and_release',{
        target_org:organizationId,target_lease:selectedId,effective_date:endDate,
        justification:reason.trim(),handover_confirmed:true,
        acknowledge_pending_financials:ackFinancials,
      });
      if(failure){setError('No se pudo finalizar: '+failure.message);return;}
      setNotice('Contrato finalizado y auditado. Consulta el inventario para confirmar disponibilidad. Las cuentas pendientes permanecen intactas.');
      setReason('');setHandover(false);setAckFinancials(false);setSelectedId('');setPending(null);
      window.dispatchEvent(new Event('lease-finished'));
      if(typeof data==='string')onFinished?.(data);
      setRevision(x=>x+1);
    }catch{setError('No se confirmó la operación. Actualiza antes de reintentar.');setRevision(x=>x+1);}
    finally{setBusy(false);}
  }

  if(!authorized)return <p role="status" className="rounded-xl border bg-white p-4 text-sm">
    La finalización de contratos requiere el rol ADMIN y permisos para contratos e inventario.
  </p>;
  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5"
    aria-label="Finalización y liberación de inmuebles">
    <div>
      <h2 className="text-lg font-bold">Finalizar arrendamiento y liberar inmueble</h2>
      <p className="text-sm text-slate-600">
        Solo al confirmar la entrega física se cierra el contrato. Los comprobantes, abonos y
        liquidaciones permanecen en el historial. No se efectúan pagos ni devoluciones.
      </p>
    </div>
    {loading?<p role="status" className="text-sm">Consultando contratos activos…</p>:
      leases.length===0?<p className="text-sm text-slate-600">No hay contratos activos para finalizar.</p>:
      <form onSubmit={event=>void finish(event)} className="space-y-3">
        <label className="block text-sm font-medium">Contrato vigente
          <select required value={selectedId}
            onChange={event=>{setSelectedId(event.target.value);setAckFinancials(false);setError('');}}
            className="mt-1 w-full rounded-lg border px-3 py-2">
            <option value="">Selecciona contrato para terminar</option>
            {leases.map(item=>{
              const property=properties.find(p=>p.id===item.property_id);
              return <option value={item.id} key={item.id}>
                {property?[property.code,property.title].join(' · '):'Inmueble '+item.property_id.slice(0,8)}
                {' · '}{item.contract_number||item.id.slice(0,8)}
              </option>;
            })}
          </select>
        </label>
        {selectedId&&<p className="text-sm text-slate-600">
          {pending===null?'Verificando obligaciones…':
            'Pendientes por revisar: '+pending.rent+' cánones y '+pending.owner+' liquidaciones de propietario.'}
        </p>}
        <label className="block text-sm font-medium">Fecha efectiva de entrega
          <input type="date" required value={endDate} min={leases.find(l=>l.id===selectedId)?.start_date}
            max={todayColombia()} onChange={event=>setEndDate(event.target.value)}
            className="mt-1 block rounded-lg border px-3 py-2"/>
        </label>
        <label className="block text-sm font-medium">Motivo y constancia de terminación
          <textarea required minLength={12} maxLength={1000} value={reason}
            onChange={event=>setReason(event.target.value)} rows={3}
            placeholder="Motivo de terminación y constancia de entrega de llaves…"
            className="mt-1 w-full rounded-lg border px-3 py-2"/>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={handover} onChange={event=>setHandover(event.target.checked)}/>
          Confirmo que el inquilino entregó físicamente el inmueble y sus llaves.
        </label>
        {pending&&(pending.rent>0||pending.owner>0)&&<label className="flex items-start gap-2 text-sm text-amber-900">
          <input type="checkbox" checked={ackFinancials} onChange={event=>setAckFinancials(event.target.checked)}/>
          He revisado los pendientes financieros. Seguirán registrados para cobrarlos o liquidarlos por separado.
        </label>}
        <button type="submit" disabled={busy||!selectedId||!pending||!handover||reason.trim().length<12}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy?'Finalizando…':'Finalizar contrato y liberar inmueble'}
        </button>
      </form>}
    {error&&<p role="alert" className="rounded-lg border border-amber-300 p-3 text-sm text-amber-900">{error}</p>}
    {notice&&<p role="status" className="rounded-lg border border-emerald-300 p-3 text-sm text-emerald-900">{notice}</p>}
  </section>;
}
