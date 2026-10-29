import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { rentalCanonDifference, rentalCanonWarning } from '../../core/rental-canon-reference';
import { isSignedLeaseDocument, SIGNED_LEASE_BUCKET, type SignedLeaseDocumentRef } from '../../core/signed-lease-pdf';
import { supabase } from '../../lib/supabase';

type Lease={id:string;contract_number:string|null;monthly_rent:number;status:string;end_date:string|null;start_date:string;property_id:string};
type Property={id:string;code:string;price:number|null;operation_type:string};
type SignedEvidence=SignedLeaseDocumentRef&{id:string;title:string;created_at:string};
const fieldClass='mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2';

export function ActiveLeaseCorrection({organizationId}:{organizationId:string}) {
  const {can,activeMembership}=useAuth();
  const authorized=Boolean(activeMembership?.roles.some(role=>role.key==='ADMIN')) &&
    can(PERMISSIONS.LEASES_EDIT) && can(PERMISSIONS.DOCUMENTS_VIEW);
  const [leases,setLeases]=useState<Lease[]>([]);
  const [properties,setProperties]=useState<Property[]>([]);
  const [documents,setDocuments]=useState<SignedEvidence[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [contractRent,setContractRent]=useState('');
  const [contractEnd,setContractEnd]=useState('');
  const [contractNumber,setContractNumber]=useState('');
  const [selectedEvidence,setSelectedEvidence]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [revision,setRevision]=useState(0);

  useEffect(()=>{
    let cancelled=false;
    setSelectedId('');setSelectedEvidence('');setLeases([]);setProperties([]);
    setDocuments([]);setError('');setNotice('');
    if(!organizationId||!authorized)return()=>{cancelled=true};
    setLoading(true);
    void(async()=>{
      try{
        const [leaseResult,documentResult,propertyResult]=await Promise.all([
          supabase.from('leases')
            .select('id,contract_number,monthly_rent,status,start_date,end_date,property_id')
            .eq('organization_id',organizationId).in('status',['ACTIVE','RENEWAL']).limit(501),
          supabase.from('documents')
            .select('id,title,organization_id,entity_type,entity_id,document_type,storage_bucket,storage_path,created_at')
            .eq('organization_id',organizationId).eq('entity_type','GENERAL')
            .eq('document_type','CONTRACT').eq('storage_bucket',SIGNED_LEASE_BUCKET).limit(501),
          supabase.from('properties').select('id,code,price,operation_type')
            .eq('organization_id',organizationId).limit(501),
        ]);
        if(cancelled)return;
        if(leaseResult.error||documentResult.error||propertyResult.error||
          (leaseResult.data?.length??0)>500||(documentResult.data?.length??0)>500||
          (propertyResult.data?.length??0)>500)
          throw Error('No se pudo verificar el inventario completo de contratos y documentos.');
        const scopedLeases=(leaseResult.data||[]) as Lease[];
        setLeases(scopedLeases);
        setProperties(((propertyResult.data||[]) as Property[]).map(p=>({...p,price:p.price==null?null:Number(p.price)})));
        setDocuments(((documentResult.data||[]) as SignedEvidence[]).filter(doc=>
          scopedLeases.some(lease=>isSignedLeaseDocument(doc,organizationId,lease.id))));
      }catch(e){
        if(!cancelled)setError(e instanceof Error?e.message:'No se pudieron consultar contratos activos.');
      }finally{if(!cancelled)setLoading(false)}
    })();
    return()=>{cancelled=true};
  },[organizationId,authorized,revision]);

  const selectedLease=leases.find(lease=>lease.id===selectedId);
  const selectedProperty=properties.find(property=>property.id===selectedLease?.property_id);
  const matchingDocs=documents.filter(doc=>selectedLease&&
    isSignedLeaseDocument(doc,organizationId,selectedLease.id));
  const mismatch=rentalCanonDifference(
    selectedProperty?.price,contractRent.trim()?Number(contractRent):null,selectedProperty?.operation_type);

  function chooseLease(id:string) {
    setSelectedId(id);setSelectedEvidence('');setError('');setNotice('');
    const lease=leases.find(row=>row.id===id);
    setContractRent(lease?String(lease.monthly_rent):'');
    setContractEnd(lease?.end_date||'');
    setContractNumber(lease?.contract_number||'');
  }

  async function rectify(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!authorized||busy||!selectedLease||!organizationId)return;
    const form=new FormData(event.currentTarget);
    const rent=Number(contractRent);
    const reason=String(form.get('correction_reason')||'').trim();
    if(!contractRent.trim()||!Number.isFinite(rent)||rent<=0||rent>999999999999.99||
       Math.round(rent*100)/100!==rent||reason.length<15||reason.length>500||
       !matchingDocs.some(doc=>doc.id===selectedEvidence)){
      setError('Indica canon positivo, motivo de 15-500 caracteres y el PDF firmado correcto.');
      return;
    }
    if(contractEnd&&contractEnd<selectedLease.start_date){
      setError('La fecha de terminación no puede preceder el inicio.');
      return;
    }
    const proposedNumber=contractNumber.trim()||null;
    if(Number(selectedLease.monthly_rent)===rent&&
       (selectedLease.end_date||null)===(contractEnd||null)&&
       (selectedLease.contract_number||null)===proposedNumber){
      setError('No hay cambios para guardar.');return;
    }
    if(!window.confirm((mismatch?rentalCanonWarning(mismatch)+'\n\n':'')+
       '¿Confirmas la rectificación del contrato activo respaldada por el PDF seleccionado? '+
       'No cambiará cobros registrados ni documentos existentes.'))return;

    setBusy(true);setError('');setNotice('');
    try{
      const {error:saveError}=await supabase.rpc('admin_rectify_active_lease',{
        target_org:organizationId,target_lease:selectedLease.id,
        corrected_rent:rent,corrected_end_date:contractEnd||null,
        corrected_contract_number:contractNumber,
        supporting_signed_document:selectedEvidence,correction_reason:reason,
      });
      if(saveError){setError('No se guardó la corrección: '+saveError.message);return;}
      setNotice('Contrato activo rectificado con auditoría. Revisa los cobros y los otrosí vigentes.');
      setRevision(x=>x+1);
      window.dispatchEvent(new Event('tenant-rent-updated'));
    }catch{setError('No fue posible confirmar la rectificación. Revisa los registros antes de reintentar.');}
    finally{setBusy(false)}
  }

  if(!authorized)return null;
  return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
    <h3 className="font-semibold">Corregir contrato activo · solo administrador</h3>
    <p className="mt-1 text-xs text-slate-700">
      Corrige un error material del canon, número o terminación conservando el contrato y su PDF histórico.
      No permite cambiar inmueble, inquilino, propietario ni valores ya cobrados. Para un aumento negociado
      usa el otrosí con vigencia futura.
    </p>
    {loading?<p role="status" className="mt-3 text-sm">Verificando contratos firmados…</p>:
    <form onSubmit={event=>void rectify(event)} className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-sm font-medium md:col-span-2">Contrato activo
        <select name="active_lease" className={fieldClass} value={selectedId}
          onChange={event=>chooseLease(event.target.value)} required disabled={busy}>
          <option value="">Seleccionar contrato para corregir</option>
          {leases.map(lease=><option key={lease.id} value={lease.id}>
            {lease.contract_number||lease.id} · {properties.find(p=>p.id===lease.property_id)?.code||'Inmueble'} ·
            {Number(lease.monthly_rent).toLocaleString('es-CO')} COP
          </option>)}
        </select>
      </label>
      {selectedLease&&<>
        <label className="text-sm font-medium">Canon contractual (COP)
          <input type="number" required min="0.01" step="0.01" className={fieldClass}
            value={contractRent} onChange={event=>setContractRent(event.target.value)} disabled={busy}/>
        </label>
        <label className="text-sm font-medium">Terminación
          <input type="date" className={fieldClass} value={contractEnd}
            onChange={event=>setContractEnd(event.target.value)} disabled={busy}/>
        </label>
        <label className="text-sm font-medium">Número de contrato
          <input maxLength={100} className={fieldClass} value={contractNumber}
            onChange={event=>setContractNumber(event.target.value)} disabled={busy}/>
        </label>
        <label className="text-sm font-medium">PDF firmado que respalda la corrección
          <select className={fieldClass} required value={selectedEvidence}
            onChange={event=>setSelectedEvidence(event.target.value)} disabled={busy}>
            <option value="">Seleccionar archivo firmado</option>
            {matchingDocs.map((doc,index)=><option key={doc.id} value={doc.id}>
              Documento {index+1} · {new Date(doc.created_at).toLocaleString('es-CO')}
            </option>)}
          </select>
        </label>
        {matchingDocs.length>1&&<p role="alert" className="md:col-span-2 rounded-lg border border-amber-300 bg-white p-3 text-sm text-amber-950">
          Este contrato tiene {matchingDocs.length} PDF firmados. Abre ambos desde el historial y selecciona
          el documento que respalda el canon correcto. No se eliminará ninguna versión automáticamente.
        </p>}
        {selectedProperty?.operation_type==='RENT'&&selectedProperty.price!=null&&
          <p className="text-xs text-slate-700 md:col-span-2">
            Canon anunciado: {Number(selectedProperty.price).toLocaleString('es-CO',{style:'currency',currency:'COP'})} mensuales
          </p>}
        {mismatch&&<p role="alert" className="rounded-lg border border-amber-300 bg-white p-3 text-sm text-amber-950 md:col-span-2">
          {rentalCanonWarning(mismatch)}
        </p>}
        <label className="text-sm font-medium md:col-span-2">Motivo y documento justificativo
          <textarea name="correction_reason" required minLength={15} maxLength={500} className={fieldClass}
            placeholder="Explica el error administrativo y el documento firmado que lo demuestra"
            disabled={busy}/>
        </label>
        <button type="submit" disabled={busy||!matchingDocs.length||!selectedEvidence}
          className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50 md:col-span-2">
          {busy?'Verificando y guardando…':'Guardar rectificación auditada'}
        </button>
      </>}
    </form>}
    {error&&<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {notice&&<p role="status" className="mt-3 text-sm text-emerald-900">{notice}</p>}
  </section>;
}
