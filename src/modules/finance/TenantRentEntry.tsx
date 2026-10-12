import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { parseMoneyInput } from '../../core/rent-owner-money';
import { localMonthISO } from '../../core/local-calendar';
import { supabase } from '../../lib/supabase';

type Option={id:string;label:string};
type Lease={id:string;contract_number:string|null;monthly_rent:number;status:string};
type Period={id:string;lease_id:string;period_month:string;expected_amount:number;paid_amount:number;status:string};
const validMoney = parseMoneyInput;
const thisMonth=localMonthISO;
const fieldClass='mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2';

export function TenantRentEntry({organizationId}:{organizationId:string}) {
  const {can}=useAuth();
  const contractAllowed=can(PERMISSIONS.LEASES_CREATE);
  const activationAllowed=can(PERMISSIONS.LEASES_EDIT);
  const paymentAllowed=can(PERMISSIONS.RENT_PAYMENTS_CREATE);
  const [properties,setProperties]=useState<Option[]>([]);
  const [tenants,setTenants]=useState<Option[]>([]);
  const [owners,setOwners]=useState<Option[]>([]);
  const [leases,setLeases]=useState<Lease[]>([]);
  const [periods,setPeriods]=useState<Period[]>([]);
  const [action,setAction]=useState<'CONTRACT'|'PERIOD'|'RECEIPT'>('CONTRACT');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [revision,setRevision]=useState(0);
  const pendingReceiptKey=useRef<string|null>(null);

  useEffect(()=>{
    let cancelled=false;
    setProperties([]);setTenants([]);setOwners([]);setLeases([]);setPeriods([]);setError('');
    setLoading(true);
    void(async()=>{
      try {
        const [p,t,o,l,r]=await Promise.all([
          supabase.from('properties').select('id,code,title').eq('organization_id',organizationId).limit(501),
          supabase.from('contacts').select('id,first_name,last_name').eq('organization_id',organizationId).limit(501),
          supabase.from('property_owners').select('id,first_name,last_name').eq('organization_id',organizationId).limit(501),
          supabase.from('leases').select('id,contract_number,monthly_rent,status').eq('organization_id',organizationId).limit(501),
          supabase.from('rent_payments').select('id,lease_id,period_month,expected_amount,paid_amount,status').eq('organization_id',organizationId).limit(501),
        ]);
        if(cancelled)return;
        if(p.error||t.error||o.error||l.error||r.error||[p,t,o,l,r].some(x=>(x.data?.length??0)>500))
          throw Error('No se pudieron cargar todos los registros autorizados. Revisa permisos y volumen.');
        setProperties((p.data??[]).map(x=>({id:x.id,label:[x.code,x.title].filter(Boolean).join(' · ')})));
        setTenants((t.data??[]).map(x=>({id:x.id,label:[x.first_name,x.last_name].filter(Boolean).join(' ')})));
        setOwners((o.data??[]).map(x=>({id:x.id,label:[x.first_name,x.last_name].filter(Boolean).join(' ')})));
        setLeases((l.data??[]) as Lease[]);
        setPeriods((r.data??[]) as Period[]);
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Error consultando registros.');}
      finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[organizationId,revision]);

  async function createContract(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!contractAllowed||busy)return;
    const element=event.currentTarget;const f=new FormData(element);
    const propertyId=String(f.get('property_id')||''),tenantId=String(f.get('tenant_id')||''),ownerId=String(f.get('owner_id')||'');
    const rent=validMoney(f.get('monthly_rent')),start=String(f.get('start_date')||''),end=String(f.get('end_date')||'');
    if(!properties.some(x=>x.id===propertyId)||!tenants.some(x=>x.id===tenantId)||
      (ownerId&&!owners.some(x=>x.id===ownerId))||!Number.isFinite(rent)||
      !/^\d{4}-\d{2}-\d{2}$/.test(start)||(end&&end<start)) {
      setError('Verifica el inmueble, inquilino, canon y fechas.');return;
    }
    setBusy(true);setError('');
    try {
      const {error:failure}=await supabase.from('leases').insert({
        organization_id:organizationId,property_id:propertyId,tenant_id:tenantId,owner_id:ownerId||null,
        monthly_rent:rent,start_date:start,end_date:end||null,
        contract_number:String(f.get('contract_number')||'').trim().slice(0,100)||null,status:'DRAFT',
      });
      if(failure){setError('No se pudo guardar el contrato: '+failure.message);return;}
      element.reset();setNotice('Contrato creado en borrador. Debe activarse antes de generar cobros.');
      window.dispatchEvent(new Event('tenant-rent-updated'));setRevision(x=>x+1);
    } catch {
      setError('No se confirmó la creación del contrato. Comprueba el listado antes de volver a guardarlo.');
      setRevision(x=>x+1);
    } finally {
      setBusy(false);
    }
  }

  async function activateContract(id:string) {
    if(!activationAllowed||busy||!organizationId||!leases.some(l=>l.id===id&&l.status==='DRAFT'))return;
    if(!window.confirm('¿Confirmas que revisaste el contrato y debe pasar a ACTIVO?'))return;
    setBusy(true);setError('');
    try {
      const {data:changed,error:failure}=await supabase.from('leases').update({status:'ACTIVE'})
        .eq('organization_id',organizationId).eq('id',id).eq('status','DRAFT')
        .select('id').maybeSingle();
      if(failure||!changed){setError('No se activó el contrato: '+(failure?.message??'No se encontró un borrador autorizado para actualizar.'));return;}
      setNotice('Contrato activado. Ahora puedes crear su cobro mensual.');
      setRevision(n=>n+1);
    } catch {
      setError('No se confirmó la activación. Consulta el estado del contrato antes de reintentar.');
      setRevision(n=>n+1);
    } finally {
      setBusy(false);
    }
  }

  async function createPeriod(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!paymentAllowed||busy)return;
    const f=new FormData(event.currentTarget),id=String(f.get('lease_id')||''),month=String(f.get('period')||'');
    if(!leases.some(l=>l.id===id&&l.status==='ACTIVE')||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){
      setError('Selecciona un contrato activo y un mes válido.');return;
    }
    setBusy(true);setError('');
    try {
      const {error:failure}=await supabase.rpc('create_tenant_rent_period',{
        target_org:organizationId,target_lease:id,target_period:month+'-01',
      });
      if(failure){setError('No se pudo crear el cobro: '+failure.message);return;}
      setNotice('Cobro mensual creado, sin registrar dinero recibido.');
      window.dispatchEvent(new Event('tenant-rent-updated'));setRevision(x=>x+1);
    } catch {
      setError('No se confirmó el cobro mensual. Revisa si ya existe para evitar duplicados.');
      setRevision(x=>x+1);
    } finally {
      setBusy(false);
    }
  }

  async function recordReceipt(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!paymentAllowed||busy)return;
    const element=event.currentTarget;
    const f=new FormData(element),id=String(f.get('period_id')||'');
    const amount=validMoney(f.get('amount')),method=String(f.get('method')||''),reference=String(f.get('reference')||'').trim();
    const payment=periods.find(p=>p.id===id&&p.status!=='CANCELLED');
    if(!payment||!Number.isFinite(amount)||amount>Number(payment.expected_amount)-Number(payment.paid_amount)+0.001||
      !['CASH','BANK_TRANSFER','OTHER'].includes(method)||reference.length<3||reference.length>140){
      setError('Verifica el cobro, el abono y la referencia del soporte.');return;
    }
    setBusy(true);setError('');
    if(!pendingReceiptKey.current) pendingReceiptKey.current=crypto.randomUUID();
    try {
      const {error:failure}=await supabase.rpc('record_tenant_rent_receipt',{
        target_org:organizationId,target_payment:id,receipt_amount:amount,
        receipt_method:method,receipt_reference:reference,request_key:pendingReceiptKey.current,
      });
      if(failure){setError('No se pudo registrar el abono: '+failure.message);return;}
      pendingReceiptKey.current=null;
      element.reset();
      setNotice('Abono registrado en libro auditable. No se ejecutó transferencia bancaria.');
      window.dispatchEvent(new Event('tenant-rent-updated'));setRevision(x=>x+1);
    } catch {
      // Keep the idempotency key: retrying the unchanged request cannot double-credit.
      setError('No se confirmó el abono. Verifica el saldo; si reintentas sin cambiar los datos, se conserva la misma clave de operación.');
      setRevision(x=>x+1);
    } finally {
      setBusy(false);
    }
  }

  const active=leases.filter(x=>x.status==='ACTIVE');
  const owing=periods.filter(p=>p.status!=='CANCELLED'&&Number(p.expected_amount)>Number(p.paid_amount));
  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5" aria-label="Captura de arriendos y pagos">
    <div><h2 className="text-lg font-bold">Registrar arriendos y pagos</h2>
      <p className="text-sm text-slate-600">Elige el paso correspondiente. Los cobros y abonos solo se registran para contratos activos de esta inmobiliaria.</p></div>
    <div className="flex flex-wrap gap-2">
      {([['CONTRACT','Nuevo contrato'],['PERIOD','Crear cobro mensual'],['RECEIPT','Registrar abono']] as const).map(([key,label])=>
        <button key={key} type="button" aria-pressed={action===key} onClick={()=>{setAction(key);setError('');}}
          className={'rounded-lg border px-3 py-2 text-sm font-semibold '+(action===key?'bg-slate-900 text-white':'bg-white')}>
          {label}</button>)}
    </div>
    {loading?<p role="status">Cargando información…</p>:<>
      {action==='CONTRACT'&&<form onSubmit={e=>void createContract(e)} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Inmueble<select name="property_id" required className={fieldClass}><option value="">Seleccionar inmueble</option>
          {properties.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="text-sm">Inquilino<select name="tenant_id" required className={fieldClass}><option value="">Seleccionar cliente</option>
          {tenants.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="text-sm">Propietario<select name="owner_id" className={fieldClass}><option value="">Sin vincular aún</option>
          {owners.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="text-sm">Canon mensual (COP)<input type="number" name="monthly_rent" required min="0.01" step="0.01" className={fieldClass}/></label>
        <label className="text-sm">Número de contrato<input name="contract_number" maxLength={100} className={fieldClass}/></label>
        <label className="text-sm">Inicio<input type="date" name="start_date" required className={fieldClass}/></label>
        <label className="text-sm">Finalización<input type="date" name="end_date" className={fieldClass}/></label>
        {(!properties.length||!tenants.length)&&<p className="md:col-span-2 text-sm text-amber-800">Para guardar: primero registra un inmueble en Propiedades y un inquilino en Clientes.</p>}
        <div className="md:col-span-2"><button type="submit" disabled={busy||!contractAllowed||!properties.length||!tenants.length}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">Guardar contrato en borrador</button></div>
        {activationAllowed&&leases.some(l=>l.status==='DRAFT')&&<div className="space-y-2 md:col-span-2">
          <h3 className="text-sm font-semibold">Contratos pendientes de activar</h3>
          {leases.filter(l=>l.status==='DRAFT').map(l=><div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span>{l.contract_number||l.id} · canon {Number(l.monthly_rent).toLocaleString('es-CO')} COP</span>
            <button type="button" disabled={busy} onClick={()=>void activateContract(l.id)}
              className="rounded-lg border px-3 py-1.5 font-semibold disabled:opacity-40">Activar contrato</button>
          </div>)}
        </div>}
      </form>}
      {action==='PERIOD'&&<form onSubmit={e=>void createPeriod(e)} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Contrato activo<select name="lease_id" required className={fieldClass}><option value="">Seleccionar contrato</option>
          {active.map(x=><option value={x.id} key={x.id}>{x.contract_number||x.id} · {Number(x.monthly_rent).toLocaleString('es-CO')} COP</option>)}</select></label>
        <label className="text-sm">Mes del cobro<input type="month" name="period" required defaultValue={thisMonth()} className={fieldClass}/></label>
        {!active.length&&<p className="md:col-span-2 text-sm text-amber-800">No hay contratos activos. Debes crear y activar un contrato antes de registrar su cobro.</p>}
        <div className="md:col-span-2"><button type="submit" disabled={busy||!paymentAllowed||!active.length}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">Guardar cobro del mes</button></div>
      </form>}
      {action==='RECEIPT'&&<form onSubmit={e=>void recordReceipt(e)} onChange={()=>{pendingReceiptKey.current=null;}} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Mes con saldo pendiente<select name="period_id" required className={fieldClass}><option value="">Seleccionar cobro</option>
          {owing.map(x=><option key={x.id} value={x.id}>{String(x.period_month).slice(0,7)} · {leases.find(l=>l.id===x.lease_id)?.contract_number||x.lease_id} · saldo {(Number(x.expected_amount)-Number(x.paid_amount)).toLocaleString('es-CO')} COP</option>)}</select></label>
        <label className="text-sm">Importe recibido (COP)<input type="number" name="amount" min="0.01" step="0.01" required className={fieldClass}/></label>
        <label className="text-sm">Medio<select name="method" className={fieldClass}>
          <option value="BANK_TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="OTHER">Otro</option></select></label>
        <label className="text-sm">Número de recibo o referencia<input name="reference" required minLength={3} maxLength={140} className={fieldClass}/></label>
        {!owing.length&&<p className="md:col-span-2 text-sm text-amber-800">Primero crea un cobro mensual para habilitar el registro de abonos.</p>}
        <div className="md:col-span-2"><button type="submit" disabled={busy||!paymentAllowed||!owing.length}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">Guardar abono</button></div>
      </form>}
    </>}
    {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
    {notice&&<p role="status" className="text-sm text-emerald-800">{notice}</p>}
  </section>;
}
