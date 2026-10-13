import { useEffect, useState, type FormEvent } from 'react';
import { etiquetaES } from '../../core/etiquetas-es';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { parseMoneyInput } from '../../core/rent-owner-money';
import { localDateISO } from '../../core/local-calendar';
import { supabase } from '../../lib/supabase';
import { validateSignedLeasePdf } from '../../core/signed-lease-pdf';
import { OwnerDeductionEvidence, uploadDeductionEvidence, type DeductionEvidenceFile } from './OwnerDeductionEvidence';

const CONCEPTS = [
  ['WATER','Agua'],['ELECTRICITY','Energía'],['GAS','Gas'],['WASTE','Aseo'],
  ['BUILDING_FEE','Administración'],['MAINTENANCE','Mantenimiento'],
  ['REPAIRS','Reparaciones'],['INSURANCE','Seguro'],
  ['TAX','Impuestos'],['COMMISSION','Comisión'],['OTHER','Otro'],
] as const;
const PAYER = [
  ['OWNER','Propietario'],['TENANT','Inquilino'],['AGENCY','Inmobiliaria'],
] as const;
type Line = { id:string; statement_id:string; charge_date:string; category:string;
  responsible_party:string; amount:number; description:string; support_reference:string|null;
  status:string; created_at:string; void_reason:string|null; };
type Statement = { id:string; owner_id:string|null; period_month:string;
  status:string; gross_income:number; commission_amount:number; tax_amount:number;
  other_deductions:number; net_amount:number; };
type Owner = {id:string;first_name:string;last_name:string|null};
const cop=(n:number)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:2}).format(n);
const label=(list:readonly (readonly [string,string])[],val:string)=>list.find(i=>i[0]===val)?.[1]??val;

/**
 * Records and reconciles classified charges against draft owner statements.
 */
export function OwnerDeductionLedger({ organizationId }: { organizationId:string }) {
  const {can,user,activeMembership}=useAuth();
  const readable=can(PERMISSIONS.OWNER_STATEMENTS_VIEW);
  const writable=can(PERMISSIONS.OWNER_STATEMENTS_CREATE);
  const canVoid=writable&&(activeMembership?.roles.some(role=>role.key==='ADMIN'||role.key==='ORGANIZATION_OWNER')??false);
  const canReconcile=writable&&can(PERMISSIONS.RENT_PAYMENTS_VIEW);
  const canRevert=canReconcile&&(activeMembership?.roles.some(role=>role.key==='ADMIN')??false);
  const canReadDocs=can(PERMISSIONS.DOCUMENTS_VIEW);
  const canUploadDocs=canReadDocs&&can(PERMISSIONS.DOCUMENTS_UPLOAD);
  const [statements,setStatements]=useState<Statement[]>([]);
  const [owners,setOwners]=useState<Owner[]>([]);
  const [lines,setLines]=useState<Line[]>([]);
  const [showForm,setShowForm]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  const [revision,setRevision]=useState(0);

  useEffect(()=>{
    const refresh=()=>setRevision(value=>value+1);
    window.addEventListener('owner-statement-updated',refresh);
    return()=>window.removeEventListener('owner-statement-updated',refresh);
  },[]);

  useEffect(()=>{setMessage('');},[organizationId]);
  useEffect(()=>{
    let cancelled=false;
    setStatements([]);setOwners([]);setLines([]);
    if(!readable||!organizationId){setLoading(false);return()=>{cancelled=true;};}
    setLoading(true);
    void(async()=>{
      try{
        const [s,o,l]=await Promise.all([
          supabase.from('owner_statements').select('id,owner_id,period_month,status,gross_income,commission_amount,tax_amount,other_deductions,net_amount')
            .eq('organization_id',organizationId).order('period_month',{ascending:false}).limit(200),
          supabase.from('property_owners').select('id,first_name,last_name').eq('organization_id',organizationId),
          supabase.from('owner_statement_deductions')
            .select('id,statement_id,charge_date,category,responsible_party,amount,description,support_reference,status,created_at,void_reason')
            .eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(1000),
        ]);
        if(cancelled)return;
        if(s.error||o.error||l.error) {
          setMessage('No se pudo consultar el detalle. Esta función requiere activar la migración financiera revisada y permisos válidos.');
        } else if((s.data??[]).length===200||(l.data??[]).length===1000) {
          setMessage('Hay más liquidaciones o cargos que los permitidos para esta consulta. No se mostrarán totales incompletos.');
        }else{
          setStatements((s.data??[]) as Statement[]);
          setOwners((o.data??[]) as Owner[]);
          setLines((l.data??[]) as Line[]);
        }
      }catch{
        if(!cancelled)setMessage('No fue posible consultar los movimientos de los propietarios.');
      }finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[organizationId,readable,revision]);
  if(!readable)return null;
  const active=statements.filter(s=>s.status==='DRAFT');
  const ownerName=(id:string|null)=> {
    const o=owners.find(p=>p.id===id);
    return o?[o.first_name,o.last_name].filter(Boolean).join(' '):'Sin propietario';
  };

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!writable||saving||!organizationId)return;
    const target=event.currentTarget;
    const form=new FormData(target);
    const statementId=String(form.get('statement_id')??'');
    const category=String(form.get('category')??'');
    const responsible=String(form.get('responsible_party')??'');
    const value=parseMoneyInput(form.get('amount'));
    const date=String(form.get('charge_date')??'');
    const description=String(form.get('description')??'').trim();
    const support=String(form.get('support_reference')??'').trim();
    const invoice=(target.elements.namedItem('invoice_pdf') as HTMLInputElement|null)?.files?.[0];
    const payment=(target.elements.namedItem('payment_pdf') as HTMLInputElement|null)?.files?.[0];
    const attachments:DeductionEvidenceFile[]=[];
    if(invoice)attachments.push({kind:'invoice',file:invoice});
    if(payment)attachments.push({kind:'payment',file:payment});
    if(attachments.length&&(!canUploadDocs||!user)){
      setMessage('Para adjuntar factura o comprobante necesitas permisos de consulta y carga de documentos.');
      return;
    }
    if(!active.some(s=>s.id===statementId)||!CONCEPTS.some(([key])=>key===category)
      ||!PAYER.some(([key])=>key===responsible)||!Number.isFinite(value)||value<=0
      ||value>999999999999.99
      ||!/^\d{4}-\d{2}-\d{2}$/.test(date)||description.length<4
      ||description.length>500||(support.length>0&&(support.length<3||support.length>500))){
      setMessage('Verifica la liquidación en borrador, responsable, concepto, importe y soporte.');
      return;
    }
    setSaving(true);setMessage('');
    let created=false;
    try {
      // Reject an invalid file before creating a ledger movement that cannot be undone.
      for(const attachment of attachments){
        const invalid=await validateSignedLeasePdf(attachment.file);
        if(invalid){
          setMessage((attachment.kind==='invoice'?'Factura':'Comprobante')+': '+invalid);
          return;
        }
      }
      const {data:record,error}=await supabase.from('owner_statement_deductions').insert({
        organization_id:organizationId,statement_id:statementId,charge_date:date,
        category,responsible_party:responsible,amount:value,description,
        support_reference:support||null,
      }).select('id').single();
      if(error||!record){setMessage('No se pudo guardar el descuento: '+(error?.message??'Sin confirmación de la fila creada.'));return;}
      created=true;
      const failed:string[]=[];
      for(const attachment of attachments){
        const uploadError=await uploadDeductionEvidence({
          organizationId,deductionId:record.id,userId:user!.id,category,
          kind:attachment.kind,file:attachment.file,
        });
        if(uploadError)failed.push(uploadError);
      }
      target.reset();setShowForm(false);setRevision(v=>v+1);
      setMessage(failed.length
        ?'Deducción creada en borrador. Algunos PDF no se pudieron vincular: '+failed.join(' ')+
          ' Usa «Adjuntar / ver PDFs» en la fila; no crees otra deducción.'
        :'Movimiento creado en borrador'+(attachments.length?' con sus PDF privados':'')+
          '. Debe aprobarse antes de conciliación.');
    } catch {
      setMessage(created
        ?'La deducción sí fue creada; no se pudo confirmar la carga de PDF. Verifica los soportes en la fila antes de reintentar.'
        :'No se confirmó la deducción. Revisa el libro antes de volver a crearla para evitar duplicados.');
      setRevision(v=>v+1);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(line:Line,status:'APPROVED'|'VOIDED'){
    if(!writable||saving||!organizationId||(status==='VOIDED'&&!canVoid))return;
    if(!statements.some(s=>s.id===line.statement_id&&s.status==='DRAFT'))return;
    if(status==='APPROVED'&&line.status!=='DRAFT')return;
    if(status==='VOIDED'&&line.status==='VOIDED')return;
    let reason='';
    if(status==='VOIDED'){
      reason=window.prompt('Describe el motivo de anulación (mínimo 6 caracteres):')?.trim()||'';
      if(reason.length<6||reason.length>500)return;
    }else if(!window.confirm('¿Confirmas aprobar el concepto y su responsable? No constituye un pago bancario.'))return;
    setSaving(true);setMessage('');
    try {
      const {data:changed,error}=await supabase.from('owner_statement_deductions')
        .update(status==='VOIDED'?{status,void_reason:reason}:{status})
        .eq('id',line.id).eq('organization_id',organizationId).eq('statement_id',line.statement_id)
        .select('id').maybeSingle();
      if(error||!changed)setMessage('No se actualizó la deducción: '+(error?.message??'Sin filas autorizadas o el estado ya cambió.'));
      else{setRevision(v=>v+1);setMessage('Deducción actualizada. Vuelve a conciliar la liquidación para recalcular el neto.');}
    } catch {
      setMessage('No se confirmó el estado de la deducción. Consulta el movimiento antes de reintentar.');
      setRevision(v=>v+1);
    } finally {
      setSaving(false);
    }
  }

  async function restoreVoidedDeduction(line:Line) {
    if(!canVoid||saving||!organizationId||line.status!=='VOIDED'
      ||!statements.some(s=>s.id===line.statement_id&&s.status==='DRAFT'))return;
    const reason=window.prompt('Motivo de recuperación de la deducción (mínimo 15 caracteres):')?.trim();
    if(!reason)return;
    if(reason.length<15||reason.length>500){setMessage('El motivo debe tener de 15 a 500 caracteres.');return;}
    if(!window.confirm('Se creará una NUEVA deducción en borrador para revisión. La deducción anulada permanecerá en el historial. ¿Continuar?'))return;
    setSaving(true);setMessage('');
    try {
      const {data,error}=await supabase.rpc('restore_voided_owner_deduction',{
        target_org:organizationId,target_deduction:line.id,restore_reason:reason
      });
      if(error){setMessage('No se pudo recuperar la deducción: '+error.message);return;}
      setMessage('Deducción recuperada como nuevo borrador ('+String(data)+'). Apruébala y concilia la liquidación cuando corresponda.');
      setRevision(v=>v+1);
    }catch{setMessage('No se confirmó la recuperación. Actualiza antes de repetir.');}
    finally{setSaving(false);}
  }

  async function reconcileStatement(statement:Statement) {
    if(!canReconcile||saving||!organizationId||statement.status!=='DRAFT')return;
    if(!window.confirm('¿Actualizar la conciliación con los abonos y deducciones aprobadas actuales? Se registrará una revisión auditada. No transfiere fondos.'))return;
    setSaving(true);setMessage('');
    try {
      const {error}=await supabase.rpc('reconcile_owner_draft_statement_audited',{
        target_org:organizationId,target_statement:statement.id,
      });
      if(error){setMessage('No se pudo conciliar: '+error.message);return;}
      setMessage('Conciliación actualizada y revisión guardada en auditoría. No se realizó ningún giro.');
      window.dispatchEvent(new Event('owner-statement-updated'));
    } catch {
      setMessage('No se pudo confirmar la conciliación. Verifica el neto actual antes de reintentar.');
      setRevision(v=>v+1);
    } finally {
      setSaving(false);
    }
  }

  async function revertStatement(statement:Statement) {
    if(!canRevert||saving||!organizationId||statement.status!=='DRAFT')return;
    const reason=window.prompt('Motivo de la reversión financiera (8 a 500 caracteres):')?.trim()??'';
    if(reason.length<8||reason.length>500){
      if(reason) setMessage('El motivo debe contener entre 8 y 500 caracteres.');
      return;
    }
    if(!window.confirm('¿Deshacer la última conciliación auditada y restaurar sus importes anteriores? Los pagos, deducciones y comprobantes permanecerán registrados.'))return;
    setSaving(true);setMessage('');
    try {
      const {error}=await supabase.rpc('revert_owner_draft_reconciliation',{
        target_org:organizationId,target_statement:statement.id,reason,
      });
      if(error){
        setMessage('No se pudo deshacer la conciliación: '+error.message+
          ' Las conciliaciones previas al nuevo historial no pueden revertirse automáticamente.');
        return;
      }
      setMessage('Última conciliación revertida con trazabilidad de auditoría. Revisa el borrador antes de volver a conciliar.');
      window.dispatchEvent(new Event('owner-statement-updated'));
    } catch {
      setMessage('No se confirmó la reversión. Consulta los importes actuales antes de repetir la acción.');
      setRevision(v=>v+1);
    } finally {setSaving(false);}
  }

  const approvedOwnerOther=lines.filter(x=>x.status==='APPROVED'&&x.responsible_party==='OWNER'
    &&x.category!=='TAX'&&x.category!=='COMMISSION')
    .reduce((sum,x)=>sum+Number(x.amount),0);
  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">Deducciones detalladas por propietario</h2>
        <p className="mt-1 text-sm text-slate-600">Agua, energía, gas, reparaciones, administración y demás conceptos, con responsable, soporte y aprobación.</p>
      </div>
      {writable && <button type="button" onClick={()=>setShowForm(v=>!v)}
        className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
        {showForm?'Cerrar formulario':'+ Registrar deducción'}
      </button>}
    </div>
    <p className="text-xs text-slate-600">Solo se descuentan al propietario los cargos aprobados cuya responsabilidad sea del propietario. Los conceptos del inquilino y de la inmobiliaria permanecen separados. El estado del extracto no certifica giro ni movimiento de fondos.</p>
    {message&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    {canReconcile&&active.length>0&&<div className="space-y-2 rounded-xl border p-3">
      <h3 className="text-sm font-bold">Conciliar y actualizar el neto del propietario</h3>
      {active.map(statement=><div key={statement.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{ownerName(statement.owner_id)} · {statement.period_month}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={saving} onClick={()=>void reconcileStatement(statement)}
            className="rounded-lg border px-3 py-1.5 font-semibold disabled:opacity-40">Actualizar conciliación</button>
          {canRevert&&<button type="button" disabled={saving} onClick={()=>void revertStatement(statement)}
            className="rounded-lg border border-red-300 px-3 py-1.5 font-semibold text-red-800 disabled:opacity-40">
            Deshacer última conciliación
          </button>}
        </div>
      </div>)}
      <p className="text-xs text-slate-600">
        «Actualizar» vuelve a calcular el borrador con ingresos y cargos aprobados y deja auditoría.
        «Deshacer» requiere ser administrador y una conciliación reciente con importe previo auditado;
        no elimina pagos, soportes ni cargos, y se bloquea si cambiaron las fuentes o ya se generó/pagó el extracto.
        Las conciliaciones antiguas sin historial no pueden deshacerse automáticamente.
      </p>
    </div>}
    {showForm&&writable&&<form onSubmit={e=>void submit(e)} className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-2">
      <label className="text-sm">Liquidación en borrador
        <select required name="statement_id" className="mt-1 block w-full rounded-lg border p-2">
          <option value="">Seleccionar liquidación…</option>
          {active.map(s=><option key={s.id} value={s.id}>{ownerName(s.owner_id)} · {s.period_month}</option>)}
        </select>
      </label>
      <label className="text-sm">Concepto
        <select required name="category" className="mt-1 block w-full rounded-lg border p-2">
          {CONCEPTS.filter(([code])=>code!=='COMMISSION').map(([code,name])=><option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label className="text-sm">Quién asume el gasto
        <select required name="responsible_party" className="mt-1 block w-full rounded-lg border p-2">
          {PAYER.map(([code,name])=><option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label className="text-sm">Importe
        <input type="number" name="amount" required min="0.01" step="0.01" className="mt-1 block w-full rounded-lg border p-2" />
      </label>
      <label className="text-sm">Fecha del cargo
        <input type="date" name="charge_date" required defaultValue={localDateISO()} className="mt-1 block w-full rounded-lg border p-2" />
      </label>
      <label className="text-sm">Número de factura o referencia (opcional)
        <input name="support_reference" maxLength={500} placeholder="Ej. Factura de agua N.º 1540"
          className="mt-1 block w-full rounded-lg border p-2" />
      </label>
      <label className="text-sm">Factura o recibo del servicio (PDF)
        <input name="invoice_pdf" type="file" accept=".pdf,application/pdf"
          disabled={!canUploadDocs||saving} className="mt-1 block w-full rounded-lg border bg-white p-2 text-sm" />
      </label>
      <label className="text-sm">Comprobante de pago (PDF)
        <input name="payment_pdf" type="file" accept=".pdf,application/pdf"
          disabled={!canUploadDocs||saving} className="mt-1 block w-full rounded-lg border bg-white p-2 text-sm" />
      </label>
      {!canUploadDocs&&<p className="text-xs text-amber-800 md:col-span-2">
        Tu perfil puede registrar la deducción, pero necesita los permisos «documentos: ver y cargar» para adjuntar PDF.
      </p>}
      <p className="text-xs text-slate-600 md:col-span-2">
         La comisión inmobiliaria se configura como porcentaje al crear la liquidación.
         El importe calculado en COP no debe repetirse como deducción, para evitar descuentos duplicados.
       </p>
       <p className="text-xs text-slate-600 md:col-span-2">
        Puedes adjuntar uno o ambos PDF de máximo 10 MB cada uno. El comprobante se conserva
        para revisión; subirlo no marca el gasto como pagado ni autoriza un giro.
      </p>
      <label className="text-sm md:col-span-2">Justificación
        <textarea name="description" required minLength={4} maxLength={500} className="mt-1 block w-full rounded-lg border p-2" />
      </label>
      {!active.length&&<p role="alert" className="md:col-span-2 text-sm text-amber-800">Primero crea un contrato de arriendo y una liquidación en borrador de su propietario.</p>}
      <button type="submit" disabled={saving||!active.length} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">
        {saving?'Guardando…':'Guardar deducción en borrador'}
      </button>
    </form>}
    {loading?<p>Cargando movimientos…</p>:
      lines.length===0?<p className="text-sm text-slate-500">Aún no hay deducciones registradas. Los importes de extractos existentes no se modifican automáticamente.</p>:
      <>
        <p className="text-sm font-semibold">Cargos aprobados a cargo del propietario, excluyendo impuestos y comisiones ya registrados: {cop(approvedOwnerOther)}</p>
        <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b">
          <th className="p-2">Período</th><th className="p-2">Concepto</th>
          <th className="p-2">Responsable</th><th className="p-2">Valor</th>
          <th className="p-2">Soporte</th><th className="p-2">Estado</th><th className="p-2">Acciones</th>
        </tr></thead><tbody>{lines.map(line=>{
          const statement=statements.find(s=>s.id===line.statement_id);
          const editable=writable&&statement?.status==='DRAFT';
          return <tr key={line.id} className="border-b border-stone-100">
            <td className="p-2">{statement?.period_month||'—'}</td>
            <td className="p-2">{label(CONCEPTS,line.category)}<div className="text-xs text-slate-500">{line.description}</div></td>
            <td className="p-2">{label(PAYER,line.responsible_party)}</td>
            <td className="p-2">{cop(Number(line.amount))}</td>
            <td className="p-2">
              {line.support_reference&&<span className="block text-xs">{line.support_reference}</span>}
              <OwnerDeductionEvidence key={line.id} organizationId={organizationId}
                deductionId={line.id} category={line.category} userId={user?.id}
                canRead={canReadDocs} canUpload={canUploadDocs&&writable&&editable&&line.status!=='VOIDED'} />
            </td>
            <td className="p-2">{etiquetaES(line.status)}</td>
            <td className="flex gap-2 p-2">
              {editable&&line.status==='DRAFT'&&<button type="button" disabled={saving} onClick={()=>void changeStatus(line,'APPROVED')} className="text-xs underline">Aprobar</button>}
              {editable&&canVoid&&line.status==='VOIDED'&&<button type="button" disabled={saving} onClick={()=>void restoreVoidedDeduction(line)} className="text-xs underline text-emerald-700">Recuperar como borrador</button>}
              {editable&&canVoid&&line.status!=='VOIDED'&&<button type="button" disabled={saving} onClick={()=>void changeStatus(line,'VOIDED')} className="text-xs underline">Anular</button>}
            </td>
          </tr>;
        })}</tbody></table></div>
      </>}
  </section>;
}
