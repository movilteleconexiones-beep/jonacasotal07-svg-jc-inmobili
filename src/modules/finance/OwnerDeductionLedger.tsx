import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';

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
 * STAGING FEATURE: requires vetted owner_statement_deductions migration.
 * No automatic charges, bank transfers, DIAN invoices, or Wompi connections.
 */
export function OwnerDeductionLedger({ organizationId }: { organizationId:string }) {
  const {can}=useAuth();
  const readable=can(PERMISSIONS.OWNER_STATEMENTS_VIEW);
  const writable=can(PERMISSIONS.OWNER_STATEMENTS_CREATE);
  const [statements,setStatements]=useState<Statement[]>([]);
  const [owners,setOwners]=useState<Owner[]>([]);
  const [lines,setLines]=useState<Line[]>([]);
  const [showForm,setShowForm]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  const [revision,setRevision]=useState(0);

  useEffect(()=>{
    let cancelled=false;
    setStatements([]);setOwners([]);setLines([]);setMessage('');
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
    const value=Number(form.get('amount'));
    const date=String(form.get('charge_date')??'');
    const description=String(form.get('description')??'').trim();
    const support=String(form.get('support_reference')??'').trim();
    if(!active.some(s=>s.id===statementId)||!CONCEPTS.some(([key])=>key===category)
      ||!PAYER.some(([key])=>key===responsible)||!Number.isFinite(value)||value<=0
      ||Math.round(value*100)!==value*100||value>999999999999.99
      ||!/^\d{4}-\d{2}-\d{2}$/.test(date)||description.length<4
      ||description.length>500||(support.length>0&&(support.length<3||support.length>500))){
      setMessage('Verifica la liquidación en borrador, responsable, concepto, importe y soporte.');
      return;
    }
    setSaving(true);setMessage('');
    const {error}=await supabase.from('owner_statement_deductions').insert({
      organization_id:organizationId,statement_id:statementId,charge_date:date,
      category,responsible_party:responsible,amount:value,description,
      support_reference:support||null,
    });
    setSaving(false);
    if(error){setMessage('No se pudo guardar el descuento: '+error.message);return;}
    target.reset();setShowForm(false);setRevision(v=>v+1);
    setMessage('Movimiento creado en borrador. Debe aprobarse antes de conciliación.');
  }

  async function changeStatus(line:Line,status:'APPROVED'|'VOIDED'){
    if(!writable||saving||!organizationId)return;
    if(!statements.some(s=>s.id===line.statement_id&&s.status==='DRAFT'))return;
    if(status==='APPROVED'&&line.status!=='DRAFT')return;
    if(status==='VOIDED'&&line.status==='VOIDED')return;
    let reason='';
    if(status==='VOIDED'){
      reason=window.prompt('Describe el motivo de anulación (mínimo 6 caracteres):')?.trim()||'';
      if(reason.length<6||reason.length>500)return;
    }else if(!window.confirm('¿Confirmas aprobar el concepto y su responsable? No constituye un pago bancario.'))return;
    setSaving(true);setMessage('');
    const {error}=await supabase.from('owner_statement_deductions')
      .update(status==='VOIDED'?{status,void_reason:reason}:{status})
      .eq('id',line.id).eq('organization_id',organizationId).eq('statement_id',line.statement_id);
    setSaving(false);
    if(error)setMessage('No se pudo cambiar el estado: '+error.message);
    else{setRevision(v=>v+1);setMessage('Estado actualizado y auditado.');}
  }

  async function reconcileStatement(statement:Statement) {
    if(!writable||saving||!organizationId||statement.status!=='DRAFT')return;
    if(!window.confirm('¿Actualizar el neto con los abonos y deducciones aprobadas? Esto no realiza transferencias.'))return;
    setSaving(true);setMessage('');
    const {error}=await supabase.rpc('reconcile_owner_draft_statement',{
      target_org:organizationId,target_statement:statement.id,
    });
    setSaving(false);
    if(error){setMessage('No se pudo conciliar: '+error.message);return;}
    setMessage('Neto actualizado según los ingresos registrados y descuentos aprobados.');
    window.dispatchEvent(new Event('owner-statement-updated'));
    setRevision(x=>x+1);
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
    {writable&&active.length>0&&<div className="space-y-2 rounded-xl border p-3">
      <h3 className="text-sm font-bold">Conciliar y actualizar el neto del propietario</h3>
      {active.map(statement=><div key={statement.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{ownerName(statement.owner_id)} · {statement.period_month}</span>
        <button type="button" disabled={saving} onClick={()=>void reconcileStatement(statement)}
          className="rounded-lg border px-3 py-1.5 font-semibold disabled:opacity-40">Conciliar descuentos</button>
      </div>)}
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
          {CONCEPTS.map(([code,name])=><option key={code} value={code}>{name}</option>)}
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
        <input type="date" name="charge_date" required defaultValue={new Date().toISOString().slice(0,10)} className="mt-1 block w-full rounded-lg border p-2" />
      </label>
      <label className="text-sm">Referencia del soporte
        <input name="support_reference" maxLength={500} placeholder="Factura o soporte" className="mt-1 block w-full rounded-lg border p-2" />
      </label>
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
            <td className="p-2">{line.support_reference||'Pendiente de soporte'}</td>
            <td className="p-2">{line.status}</td>
            <td className="flex gap-2 p-2">
              {editable&&line.status==='DRAFT'&&<button type="button" disabled={saving} onClick={()=>void changeStatus(line,'APPROVED')} className="text-xs underline">Aprobar</button>}
              {editable&&line.status!=='VOIDED'&&<button type="button" disabled={saving} onClick={()=>void changeStatus(line,'VOIDED')} className="text-xs underline">Anular</button>}
            </td>
          </tr>;
        })}</tbody></table></div>
      </>}
  </section>;
}
