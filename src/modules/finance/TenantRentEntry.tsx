import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { parseMoneyInput } from '../../core/rent-owner-money';
import { rentalCanonDifference, rentalCanonWarning } from '../../core/rental-canon-reference';
import { localMonthISO } from '../../core/local-calendar';
import { supabase } from '../../lib/supabase';
import { SignedLeaseDocuments } from './SignedLeaseDocuments';
import { canPrepareRental } from '../../core/rental-owner-selection';
import {
  RENT_RECEIPT_EVIDENCE_BUCKET, receiptEvidencePath, validateRentReceiptEvidence,
} from '../../core/rent-receipt-evidence';
import { RentReceiptEvidenceHistory } from './RentReceiptEvidenceHistory';

export type RentalEntryMode='STANDARD'|'DRAFT'|'SIGNED_PDF'|'APPROVAL'|'BILLING';
type Option={id:string;label:string};
type PropertyOption=Option&{price:number|null;operation_type:string};
type Lease={id:string;contract_number:string|null;monthly_rent:number;status:string;
  property_id:string;tenant_id:string|null;owner_id:string|null;start_date:string;end_date:string|null};
type Period={id:string;lease_id:string;period_month:string;expected_amount:number;paid_amount:number;status:string};
const validMoney = parseMoneyInput;
const thisMonth=localMonthISO;
const fieldClass='mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2';

export function TenantRentEntry({organizationId,mode='STANDARD',preferredPropertyId,preferredTenantId,preferredOwnerId,preferredLeaseId,onDraftCreated,onPdfUploaded,onActivated}:{
  organizationId:string;mode?:RentalEntryMode;preferredPropertyId?:string;preferredTenantId?:string;preferredOwnerId?:string;preferredLeaseId?:string;
  onDraftCreated?:(id:string)=>void;onPdfUploaded?:(id:string)=>void;onActivated?:(id:string)=>void;
}) {
  const {can,activeMembership,user}=useAuth();
  const contractAllowed=can(PERMISSIONS.LEASES_CREATE);
  const activationAllowed=can(PERMISSIONS.LEASES_EDIT) &&
    (activeMembership?.roles.some(role=>role.key==='ADMIN')??false);
  const paymentAllowed=can(PERMISSIONS.RENT_PAYMENTS_CREATE);
  const canReadRent=can(PERMISSIONS.RENT_PAYMENTS_VIEW);
  const [properties,setProperties]=useState<PropertyOption[]>([]);
  const [newPropertyId,setNewPropertyId]=useState(preferredPropertyId||'');
  const [newRent,setNewRent]=useState('');
  const [draftPropertyId,setDraftPropertyId]=useState('');
  const [draftRent,setDraftRent]=useState('');
  const [tenants,setTenants]=useState<Option[]>([]);
  const [owners,setOwners]=useState<Option[]>([]);
  const [leases,setLeases]=useState<Lease[]>([]);
  const [periods,setPeriods]=useState<Period[]>([]);
  const [action,setAction]=useState<'CONTRACT'|'PERIOD'|'RECEIPT'|'SIGNED_PDF'>(
    mode==='BILLING'?'PERIOD':mode==='SIGNED_PDF'?'SIGNED_PDF':'CONTRACT');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [revision,setRevision]=useState(0);
  const [draftEditor,setDraftEditor]=useState<string|null>(null);
  const [draftWorking,setDraftWorking]=useState(false);
  const pendingReceiptRequest=useRef<{
    fingerprint:string; key:string; uploadedPath?:string;
  }|null>(null);

  useEffect(()=>{
    let cancelled=false;
    setProperties([]);setTenants([]);setOwners([]);setLeases([]);setPeriods([]);
    setDraftEditor(null);setError('');setNewPropertyId(preferredPropertyId||'');
    setNewRent('');setDraftPropertyId('');setDraftRent('');
    setLoading(true);
    void(async()=>{
      try {
        const [p,t,o,l,r]=await Promise.all([
          supabase.from('properties').select('id,code,title,price,operation_type').eq('organization_id',organizationId).limit(501),
          supabase.from('contacts').select('id,first_name,last_name').eq('organization_id',organizationId).limit(501),
          supabase.from('property_owners').select('id,first_name,last_name').eq('organization_id',organizationId).eq('agency_status','ACTIVE').limit(501),
          supabase.from('leases').select('id,contract_number,monthly_rent,status,property_id,tenant_id,owner_id,start_date,end_date').eq('organization_id',organizationId).limit(501),
          canReadRent ? supabase.from('rent_payments').select('id,lease_id,period_month,expected_amount,paid_amount,status')
            .eq('organization_id',organizationId).limit(501)
            : Promise.resolve({data:[] as Period[],error:null}),
        ]);
        if(cancelled)return;
        if(p.error||t.error||o.error||l.error||r.error||[p,t,o,l,r].some(x=>(x.data?.length??0)>500))
          throw Error('No se pudieron cargar todos los registros autorizados. Revisa permisos y volumen.');
        setProperties((p.data??[]).map(x=>({id:x.id,label:[x.code,x.title].filter(Boolean).join(' · '),
          price:x.price==null?null:Number(x.price),operation_type:x.operation_type})));
        setTenants((t.data??[]).map(x=>({id:x.id,label:[x.first_name,x.last_name].filter(Boolean).join(' ')})));
        setOwners((o.data??[]).map(x=>({id:x.id,label:[x.first_name,x.last_name].filter(Boolean).join(' ')})));
        setLeases((l.data??[]) as Lease[]);
        setPeriods((r.data??[]) as Period[]);
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Error consultando registros.');}
      finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[organizationId,revision]);

  const newProperty=properties.find(p=>p.id===newPropertyId);
  const newCanonMismatch=rentalCanonDifference(
    newProperty?.price,newRent.trim()?Number(newRent):null,newProperty?.operation_type);
  const draftProperty=properties.find(p=>p.id===draftPropertyId);
  const draftCanonMismatch=rentalCanonDifference(
    draftProperty?.price,draftRent.trim()?Number(draftRent):null,draftProperty?.operation_type);

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
      {
        // Read-only preflight: never trust a visual owner name or a property inventory code.
        // Activation is still protected by database constraints and administrator approval.
        const [propertyCheck,occupationCheck]=await Promise.all([
          supabase.from('properties').select('id,status,operation_type,price')
            .eq('organization_id',organizationId).eq('id',propertyId).maybeSingle(),
          supabase.from('leases').select('id',{count:'exact',head:true})
            .eq('organization_id',organizationId).eq('property_id',propertyId)
            .in('status',['DRAFT','ACTIVE','RENEWAL']),
        ]);
        if(propertyCheck.error||!propertyCheck.data||occupationCheck.error||occupationCheck.count==null){
          setError('No se pudo verificar la disponibilidad del inmueble. Vuelve a consultar antes de guardar.');return;
        }
        if(!canPrepareRental({...propertyCheck.data,code:'',title:'',
          has_active_lease:occupationCheck.count>0})){
          setError('Este inmueble ya tiene un contrato en borrador o vigente. Corrige el existente en vez de crear otro.');return;
        }
        const priceCheck=rentalCanonDifference(
          propertyCheck.data.price==null?null:Number(propertyCheck.data.price),rent,propertyCheck.data.operation_type);
        if(priceCheck&&!window.confirm(rentalCanonWarning(priceCheck)+'\n\n¿Confirmas que el canon diferente fue acordado?')){
          setError('Revisa el canon del inmueble antes de guardar el contrato.');return;
        }
        if(ownerId){
          const {data:link,error:linkError}=await supabase.from('property_ownerships')
            .select('owner_id').eq('property_id',propertyId).eq('owner_id',ownerId).maybeSingle();
          if(linkError||!link){
            setError('El propietario elegido no está vinculado a este inmueble. Corrige la selección antes de guardar.');return;
          }
        }
      }
      const {data:created,error:failure}=await supabase.from('leases').insert({
        organization_id:organizationId,property_id:propertyId,tenant_id:tenantId,owner_id:ownerId||null,
        monthly_rent:rent,start_date:start,end_date:end||null,
        contract_number:String(f.get('contract_number')||'').trim().slice(0,100)||null,status:'DRAFT',
      }).select('id').single();
      if(failure||!created){setError('No se pudo guardar el contrato: '+(failure?.message??'No hubo confirmación de la fila.'));return;}
      element.reset();setNewPropertyId('');setNewRent('');
      setNotice('Contrato creado en borrador. Debe activarse antes de generar cobros.');
      window.dispatchEvent(new Event('tenant-rent-updated'));setRevision(x=>x+1);
      onDraftCreated?.(created.id);
    } catch {
      setError('No se confirmó la creación del contrato. Comprueba el listado antes de volver a guardarlo.');
      setRevision(x=>x+1);
    } finally {
      setBusy(false);
    }
  }

  async function correctDraft(event:FormEvent<HTMLFormElement>,lease:Lease) {
    event.preventDefault();
    if (!activationAllowed||busy||draftWorking||lease.status!=='DRAFT') return;
    const f=new FormData(event.currentTarget);
    const targetProperty=String(f.get('property_id')||'');
    const targetTenant=String(f.get('tenant_id')||'');
    const targetOwner=String(f.get('owner_id')||'');
    const rent=validMoney(f.get('monthly_rent'));
    const start=String(f.get('start_date')||'');
    const end=String(f.get('end_date')||'');
    const number=String(f.get('contract_number')||'').trim();
    const reason=String(f.get('reason')||'').trim();
    if(!properties.some(x=>x.id===targetProperty)||!tenants.some(x=>x.id===targetTenant)||
       (targetOwner&&!owners.some(x=>x.id===targetOwner))||
       !Number.isFinite(rent)||rent<=0||!/^\d{4}-\d{2}-\d{2}$/.test(start)||
       (end&&end<start)||reason.length<12||reason.length>500){
      setError('Revisa inmueble, cliente, canon, fechas y motivo (mínimo 12 caracteres).');
      return;
    }
    if(!window.confirm('¿Guardar corrección del borrador? Se registrarán los datos anteriores, nuevos y el motivo en auditoría.'))return;
    setDraftWorking(true);setError('');
    try{
      const currentProperty=await supabase.from('properties')
        .select('price,operation_type').eq('organization_id',organizationId).eq('id',targetProperty).maybeSingle();
      if(currentProperty.error||!currentProperty.data){
        setError('No pudimos verificar el canon publicado. Actualiza la información.');return;
      }
      const difference=rentalCanonDifference(
        currentProperty.data.price==null?null:Number(currentProperty.data.price),rent,
        currentProperty.data.operation_type);
      if(difference&&!window.confirm(rentalCanonWarning(difference)+'\n\n¿Guardar este canon justificado?')){
        setError('Revisa el canon antes de corregir el borrador.');return;
      }
      const {error:failure}=await supabase.rpc('admin_correct_lease_draft',{
        target_org:organizationId,target_lease:lease.id,target_property:targetProperty,
        target_tenant:targetTenant,target_owner:targetOwner||null,
        target_monthly_rent:rent,target_start:start,target_end:end||null,
        target_contract_number:number,reason,
      });
      if(failure){setError('No se pudo corregir el borrador: '+failure.message);return;}
      setDraftEditor(null);
      setNotice('Borrador corregido sin duplicar contrato. Auditoría guardada.');
      window.dispatchEvent(new Event('tenant-rent-updated'));
      setRevision(value=>value+1);
    }catch{
      setError('No se confirmó la corrección; consulta el contrato antes de reintentar.');
      setRevision(value=>value+1);
    }finally{setDraftWorking(false);}
  }

  async function cancelDraft(lease:Lease){
    if(!activationAllowed||busy||draftWorking||lease.status!=='DRAFT')return;
    const reason=window.prompt('Motivo de anulación del borrador (12 a 500 caracteres). Los PDF se conservarán.')?.trim();
    if(!reason)return;
    if(reason.length<12||reason.length>500){
      setError('Escribe un motivo de anulación de 12 a 500 caracteres.');return;
    }
    if(!window.confirm('¿Anular el borrador? No se borrará el historial ni sus documentos y el inmueble quedará libre para un nuevo contrato.'))return;
    setDraftWorking(true);setError('');
    try{
      const {error:failure}=await supabase.rpc('admin_cancel_lease_draft',{
        target_org:organizationId,target_lease:lease.id,reason,
      });
      if(failure){setError('No se pudo anular el borrador: '+failure.message);return;}
      setDraftEditor(null);setNotice('Borrador anulado con auditoría. El contrato y los PDF históricos permanecen registrados.');
      window.dispatchEvent(new Event('tenant-rent-updated'));
      setRevision(value=>value+1);
    }catch{
      setError('No se confirmó la anulación. Actualiza la lista antes de intentar nuevamente.');
      setRevision(value=>value+1);
    }finally{setDraftWorking(false);}
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
      // The database marks the property RENTED in the approval transaction.
      setNotice('Contrato aprobado y activado. El inmueble figura ahora como arrendado.');
      window.dispatchEvent(new Event('lease-activated'));
      window.dispatchEvent(new Event('tenant-rent-updated'));
      setRevision(n=>n+1);
      onActivated?.(id);
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
    const proofInput=element.elements.namedItem('evidence') as HTMLInputElement|null;
    const file=proofInput?.files?.[0]??null;
    const payment=periods.find(p=>p.id===id&&p.status!=='CANCELLED');
    if(!payment||!Number.isFinite(amount)||amount>Number(payment.expected_amount)-Number(payment.paid_amount)+0.001||
      !['CASH','BANK_TRANSFER','OTHER'].includes(method)||reference.length<3||reference.length>140){
      setError('Verifica el cobro, el abono y la referencia del soporte.');return;
    }
    const actor=user?.id;
    if(file&&!actor){setError('No se pudo verificar el usuario responsable del comprobante.');return;}
    // Keep idempotency and the uploaded path for exact retries (including
    // the file), preventing credit duplication if the network disconnects.
    const fileFingerprint=file?[file.name,file.size,file.lastModified,file.type]:null;
    const fingerprint=JSON.stringify([organizationId,id,amount,method,reference,fileFingerprint]);
    if(pendingReceiptRequest.current?.fingerprint!==fingerprint)
      pendingReceiptRequest.current={fingerprint,key:crypto.randomUUID()};
    const request=pendingReceiptRequest.current;
    setBusy(true);setError('');
    try {
      let evidencePath:string|null=null;
      if(file){
        const checked=await validateRentReceiptEvidence(file);
        if(checked.error||!checked.mime){
          setError(checked.error||'No se pudo validar el archivo del abono.');return;
        }
        const path=receiptEvidencePath(organizationId,id,actor!,request.key,checked.mime);
        evidencePath=path;
        if(request.uploadedPath!==path){
          const {error:uploadError}=await supabase.storage.from(RENT_RECEIPT_EVIDENCE_BUCKET)
            .upload(path,file,{upsert:false,contentType:checked.mime,cacheControl:'0'});
          if(uploadError){
            // An unknown network error may occur after storage committed. Do
            // not record money with missing evidence or fabricate upload success.
            setError('No se confirmó la carga del comprobante: '+uploadError.message+
              '. Comprueba el archivo antes de reintentar.');
            return;
          }
          request.uploadedPath=path;
        }
      }

      const {data:receiptId,error:failure}=file
        ? await supabase.rpc('record_tenant_rent_receipt_with_evidence',{
          target_org:organizationId,target_payment:id,receipt_amount:amount,
          receipt_method:method,receipt_reference:reference,request_key:request.key,
          evidence_path:evidencePath,
        })
        : await supabase.rpc('record_tenant_rent_receipt',{
          target_org:organizationId,target_payment:id,receipt_amount:amount,
          receipt_method:method,receipt_reference:reference,request_key:request.key,
        });
      if(failure||!receiptId){
        // Preserve the object and idempotency key on failure. This avoids
        // destroying evidence if the ledger RPC completed but its response
        // was lost. Unlinked uploads have a restricted cleanup policy.
        setError('No se pudo confirmar el abono: '+(failure?.message??'Sin confirmación del recibo.')+
          '. El comprobante no se perderá al reintentar sin modificar los datos.');
        return;
      }

      pendingReceiptRequest.current=null;
      element.reset();
      setNotice(file
        ? 'Abono registrado y comprobante privado asociado al recibo. No se ejecutó transferencia bancaria.'
        : 'Abono registrado en libro auditable, sin archivo adjunto. No se ejecutó transferencia bancaria.');
      window.dispatchEvent(new Event('tenant-rent-updated'));setRevision(x=>x+1);
    } catch {
      setError('No se confirmó el abono o su comprobante. Antes de reintentar, comprueba el historial; la clave de la operación se conservará mientras no cambies los datos.');
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
      {(mode==='BILLING' ? [['PERIOD','Crear cobro mensual'],['RECEIPT','Registrar abono']] as const :
        mode==='STANDARD' ? [['CONTRACT','Nuevo contrato'],['PERIOD','Crear cobro mensual'],['RECEIPT','Registrar abono'],['SIGNED_PDF','Contrato firmado (PDF)']] as const :
        [] as const).map(([key,label])=>
        <button key={key} type="button" aria-pressed={action===key} onClick={()=>{setAction(key);setError('');}}
          className={'rounded-lg border px-3 py-2 text-sm font-semibold '+(action===key?'bg-slate-900 text-white':'bg-white')}>
          {label}</button>)}
    </div>
    {loading?<p role="status">Cargando información…</p>:<>
      {action==='CONTRACT'&&mode!=='APPROVAL'&&<form onSubmit={e=>void createContract(e)} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Inmueble<select name="property_id" required value={newPropertyId}
          onChange={event=>setNewPropertyId(event.target.value)} className={fieldClass}><option value="">Seleccionar inmueble</option>
          {properties.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="text-sm">Inquilino<select name="tenant_id" required defaultValue={preferredTenantId||''} className={fieldClass}><option value="">Seleccionar cliente</option>
          {tenants.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="text-sm">Propietario<select name="owner_id" defaultValue={preferredOwnerId||''} className={fieldClass}><option value="">Sin vincular aún</option>
          {owners.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="text-sm">Canon mensual (COP)<input type="number" name="monthly_rent" required min="0.01" step="0.01"
          value={newRent} onChange={event=>setNewRent(event.target.value)} className={fieldClass}/></label>
        {newProperty?.operation_type==='RENT'&&newProperty.price!=null&&newProperty.price>0&&
          <p className="md:col-span-2 text-xs text-slate-700">Canon publicado para el inmueble: <strong>
            {Number(newProperty.price).toLocaleString('es-CO',{style:'currency',currency:'COP'})} mensuales</strong></p>}
        {newCanonMismatch&&<p role="alert" className="md:col-span-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          {rentalCanonWarning(newCanonMismatch)}</p>}
        <label className="text-sm">Número de contrato<input name="contract_number" maxLength={100} className={fieldClass}/></label>
        <label className="text-sm">Inicio<input type="date" name="start_date" required className={fieldClass}/></label>
        <label className="text-sm">Finalización<input type="date" name="end_date" className={fieldClass}/></label>
        {(!properties.length||!tenants.length)&&<p className="md:col-span-2 text-sm text-amber-800">Para guardar: primero registra un inmueble en Propiedades y un inquilino en Clientes.</p>}
        <div className="md:col-span-2"><button type="submit" disabled={busy||!contractAllowed||!properties.length||!tenants.length}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">Guardar contrato en borrador</button></div>
        {mode==='STANDARD'&&activationAllowed&&leases.some(l=>l.status==='DRAFT')&&<div className="space-y-2 md:col-span-2">
          <h3 className="text-sm font-semibold">Contratos pendientes de activar</h3>
          {leases.filter(l=>l.status==='DRAFT').map(l=><div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span>{l.contract_number||l.id} · canon {Number(l.monthly_rent).toLocaleString('es-CO')} COP</span>
            <button type="button" disabled={busy} onClick={()=>void activateContract(l.id)}
              className="rounded-lg border px-3 py-1.5 font-semibold disabled:opacity-40">Activar contrato</button>
          </div>)}
        </div>}
      </form>}
      {mode==='APPROVAL'&&<div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
        <h3 className="font-semibold">Revisión y aprobación del administrador</h3>
        <p className="text-sm text-slate-600">
          Antes de activar verifica el inmueble, el arrendatario, las fechas, el canon y el PDF firmado
          en la etapa anterior. Supabase impide activar sin un documento privado válido y sin el rol de administrador.
        </p>
        {leases.filter(l=>l.status==='DRAFT').length===0&&<p className="text-sm text-slate-500">
          No hay contratos en borrador pendientes de aprobación.
        </p>}
        {leases.filter(l=>l.status==='DRAFT').map(lease=><div key={lease.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3 text-sm">
          <span>{lease.contract_number||lease.id} · {Number(lease.monthly_rent).toLocaleString('es-CO')} COP</span>
          {activationAllowed?<button type="button" disabled={busy}
            onClick={()=>void activateContract(lease.id)}
            className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-40">
            Revisé el PDF · Aprobar y activar
          </button>:<span className="text-amber-800">Esperando aprobación del administrador</span>}
        </div>)}
      </div>}
      {activationAllowed&&['STANDARD','DRAFT','APPROVAL'].includes(mode)&&leases.some(l=>l.status==='DRAFT')&&
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="font-semibold">Corregir o anular contratos en borrador</h3>
          <p className="text-xs text-slate-700">No crees otro contrato del mismo inmueble. Un contrato activo solo puede finalizarse desde el cierre administrativo auditado.</p>
          {leases.filter(l=>l.status==='DRAFT').map(lease=>
            <div key={lease.id} className="space-y-3 rounded-lg border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{lease.contract_number||lease.id} · {Number(lease.monthly_rent).toLocaleString('es-CO')} COP</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={draftWorking||busy}
                    onClick={()=>{const opening=draftEditor!==lease.id;setDraftEditor(opening?lease.id:null);
                      setDraftPropertyId(opening?lease.property_id:'');
                      setDraftRent(opening?String(lease.monthly_rent):'');}}
                    className="rounded-lg border px-3 py-1.5 font-semibold">Corregir borrador</button>
                  <button type="button" disabled={draftWorking||busy}
                    onClick={()=>void cancelDraft(lease)}
                    className="rounded-lg border border-rose-300 px-3 py-1.5 font-semibold text-rose-800">Anular borrador</button>
                </div>
              </div>
              {draftEditor===lease.id&&<form key={lease.id} onSubmit={e=>void correctDraft(e,lease)}
                className="grid gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-2">
                <label>Inmueble<select name="property_id" required value={draftPropertyId}
                  onChange={event=>setDraftPropertyId(event.target.value)} className={fieldClass}>
                  {properties.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <label>Inquilino<select name="tenant_id" required defaultValue={lease.tenant_id||''} className={fieldClass}>
                  <option value="">Seleccionar inquilino</option>
                  {tenants.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
                <label>Propietario<select name="owner_id" defaultValue={lease.owner_id||''} className={fieldClass}>
                  <option value="">Sin propietario vinculado</option>
                  {owners.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
                <label>Canon mensual (COP)<input name="monthly_rent" type="number" min="0.01" step="0.01"
                  required value={draftRent} onChange={event=>setDraftRent(event.target.value)} className={fieldClass}/></label>
                {draftCanonMismatch&&<p role="alert" className="md:col-span-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  {rentalCanonWarning(draftCanonMismatch)}</p>}
                <label>Número de contrato<input name="contract_number" maxLength={100}
                  defaultValue={lease.contract_number||''} className={fieldClass}/></label>
                <label>Inicio<input name="start_date" type="date" required defaultValue={lease.start_date}
                  className={fieldClass}/></label>
                <label>Finalización<input name="end_date" type="date" defaultValue={lease.end_date||''}
                  className={fieldClass}/></label>
                <label className="md:col-span-2">Motivo de la corrección
                  <textarea name="reason" minLength={12} maxLength={500} required
                    placeholder="Describe qué dato se registró erróneamente y por qué" className={fieldClass}/></label>
                <div className="flex gap-2 md:col-span-2">
                  <button type="submit" disabled={draftWorking||busy}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Guardar corrección auditada</button>
                  <button type="button" onClick={()=>setDraftEditor(null)}
                    className="rounded-lg border px-4 py-2">Cancelar</button>
                </div>
              </form>}
            </div>)}
        </div>}
      {action==='PERIOD'&&<form onSubmit={e=>void createPeriod(e)} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Contrato activo<select name="lease_id" required defaultValue={preferredLeaseId||''} className={fieldClass}><option value="">Seleccionar contrato</option>
          {active.map(x=><option value={x.id} key={x.id}>{x.contract_number||x.id} · {Number(x.monthly_rent).toLocaleString('es-CO')} COP</option>)}</select></label>
        <label className="text-sm">Mes del cobro<input type="month" name="period" required defaultValue={thisMonth()} className={fieldClass}/></label>
        {!active.length&&<p className="md:col-span-2 text-sm text-amber-800">No hay contratos activos. Debes crear y activar un contrato antes de registrar su cobro.</p>}
        <div className="md:col-span-2"><button type="submit" disabled={busy||!paymentAllowed||!active.length}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">Guardar cobro del mes</button></div>
      </form>}
      {action==='SIGNED_PDF'&&<SignedLeaseDocuments organizationId={organizationId} leases={leases}
        preferredLeaseId={preferredLeaseId} onUploaded={onPdfUploaded} />}
      {action==='RECEIPT'&&<div>
        <form onSubmit={e=>void recordReceipt(e)}
          onChange={()=>{if(!busy)pendingReceiptRequest.current=null;}}
          className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">Mes con saldo pendiente<select name="period_id" required className={fieldClass}><option value="">Seleccionar cobro</option>
          {owing.map(x=><option key={x.id} value={x.id}>{String(x.period_month).slice(0,7)} · {leases.find(l=>l.id===x.lease_id)?.contract_number||x.lease_id} · saldo {(Number(x.expected_amount)-Number(x.paid_amount)).toLocaleString('es-CO')} COP</option>)}</select></label>
        <label className="text-sm">Importe recibido (COP)<input type="number" name="amount" min="0.01" step="0.01" required className={fieldClass}/></label>
        <label className="text-sm">Medio<select name="method" className={fieldClass}>
          <option value="BANK_TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="OTHER">Otro</option></select></label>
        <label className="text-sm">Número de recibo o referencia<input name="reference" required minLength={3} maxLength={140} className={fieldClass}/></label>
        <label className="text-sm md:col-span-2">Adjuntar comprobante del abono (foto o PDF · máximo 10 MB)
          <input name="evidence" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
            disabled={busy||!paymentAllowed} className={fieldClass}/>
          <span className="mt-1 block text-xs text-slate-600">El archivo es privado y quedará asociado al abono guardado. No sustituye el número de referencia.</span>
        </label>
        {!owing.length&&<p className="md:col-span-2 text-sm text-amber-800">Primero crea un cobro mensual para habilitar el registro de abonos.</p>}
        <div className="md:col-span-2"><button type="submit" disabled={busy||!paymentAllowed||!owing.length}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">Guardar abono</button></div>
        </form>
        <RentReceiptEvidenceHistory organizationId={organizationId} revision={revision}/>
      </div>}
    </>}
    {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
    {notice&&<p role="status" className="text-sm text-emerald-800">{notice}</p>}
  </section>;
}
