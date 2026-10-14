import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { RENT_RECEIPT_EVIDENCE_BUCKET } from '../../core/rent-receipt-evidence';
import { supabase } from '../../lib/supabase';

type Evidence = {storage_path:string;mime_type:string};
type ReceiptRow = {
  id:string;
  rent_payment_id:string;
  amount:number;
  support_reference:string;
  received_at:string;
  rent_receipt_supports: Evidence | Evidence[] | null;
};

/** Read-only, tenant-scoped history. No public URL or direct storage download. */
export function RentReceiptEvidenceHistory({organizationId,revision}:{
  organizationId:string; revision:number;
}) {
  const {can}=useAuth();
  const mayView=can(PERMISSIONS.RENT_PAYMENTS_VIEW);
  const [receipts,setReceipts]=useState<ReceiptRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let cancelled=false;
    setReceipts([]);setError('');
    if(!mayView||!organizationId)return;
    setLoading(true);
    void (async()=>{
      try {
        const {data,error:readError}=await supabase.from('rent_receipts')
          .select('id,rent_payment_id,amount,support_reference,received_at,rent_receipt_supports(storage_path,mime_type)')
          .eq('organization_id',organizationId).order('received_at',{ascending:false}).limit(30);
        if(cancelled)return;
        if(readError)throw new Error('No se pudo consultar el historial privado de abonos.');
        setReceipts((data??[]) as ReceiptRow[]);
      } catch (cause) {
        if(!cancelled)setError(cause instanceof Error?cause.message:'No se pudo consultar el historial.');
      } finally {if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[organizationId,mayView,revision]);

  async function viewEvidence(row:ReceiptRow) {
    if(!mayView)return;
    const support=Array.isArray(row.rent_receipt_supports)?
      row.rent_receipt_supports[0]:row.rent_receipt_supports;
    if(!support)return;
    // The database and storage policies independently restrict the signed link.
    setError('');
    try {
      const {data,error:signError}=await supabase.storage.from(RENT_RECEIPT_EVIDENCE_BUCKET)
        .createSignedUrl(support.storage_path,60);
      if(signError||!data?.signedUrl){
        setError('No se pudo abrir el comprobante. Comprueba los permisos de pagos.');
        return;
      }
      window.open(data.signedUrl,'_blank','noopener,noreferrer');
    } catch {
      setError('Error de conexión al consultar el comprobante.');
    }
  }

  if(!mayView)return null;
  return <section className="mt-5 space-y-2 border-t border-stone-200 pt-4" aria-label="Comprobantes y abonos registrados">
    <h3 className="text-sm font-semibold">Últimos abonos y comprobantes</h3>
    <p className="text-xs text-slate-600">
      Archivos privados vinculados al recibo contable. Un soporte no implica certificación bancaria.
    </p>
    {loading?<p role="status" className="text-sm">Consultando comprobantes…</p>:
      !receipts.length?<p className="text-sm text-slate-500">Aún no hay abonos registrados.</p>:
      <div className="space-y-2">
        {receipts.map(row=>{
          const proof=Array.isArray(row.rent_receipt_supports)?
            row.rent_receipt_supports[0]:row.rent_receipt_supports;
          return <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-semibold">{row.support_reference} · {Number(row.amount).toLocaleString('es-CO')} COP</p>
              <p className="text-xs text-slate-600">
                {new Date(row.received_at).toLocaleDateString('es-CO')}
                {' · '}{proof?'Comprobante guardado':'Sin archivo adjunto'}
              </p>
            </div>
            {proof&&<button type="button" onClick={()=>void viewEvidence(row)}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold">
              {proof.mime_type==='application/pdf'?<FileText className="h-4 w-4"/>:<ImageIcon className="h-4 w-4"/>}
              Ver comprobante
            </button>}
          </div>;
        })}
      </div>}
    {error&&<p role="alert" className="text-sm text-amber-900">{error}</p>}
  </section>;
}
