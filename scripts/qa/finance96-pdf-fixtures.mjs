/**
 * #96: isolated, disposable, real PDF fixtures for Storage RLS verification.
 * No customer data, payment gateway, real receipts or production writes.
 * Every ID is generated and registered BEFORE any network write, allowing
 * cleanup even when a response is lost after the remote insert succeeds.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export const QA96_PRIVATE_BUCKET = 'jco-rent-receipts-private';
const TEST_SLUGS = new Set([
  'sistema-inmobiliario-jco',
  'qa-finance-96-foreign-20261113',
]);
const TAG = 'QA96-ONLY';

export function createQaOnlyPdf(label) {
  const safe = String(label).replace(/[^a-zA-Z0-9 -]/g,' ').slice(0,60);
  const draw = 'BT /F1 16 Tf 52 735 Td (QA ONLY - NO REAL RECEIPT) Tj ' +
    '0 -26 Td /F1 12 Tf (' + safe + ') Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(draw,'ascii') +
      ' >>\nstream\n' + draw + '\nendstream',
  ];
  let contents = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index,body] of objects.entries()) {
    offsets.push(Buffer.byteLength(contents,'ascii'));
    contents += (index+1) + ' 0 obj\n' + body + '\nendobj\n';
  }
  const start = Buffer.byteLength(contents,'ascii');
  contents += 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    contents += String(offset).padStart(10,'0') + ' 00000 n \n';
  }
  contents += 'trailer\n<< /Size ' + offsets.length +
    ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
  return Buffer.from(contents,'ascii');
}

async function insertRow(admin,table,row) {
  const {error} = await admin.from(table).insert(row);
  if(error) throw new Error('QA fixture insert failed: '+table+' ('+String(error.code??'unknown')+')');
}

export async function createQaReceiptFixture({admin,tenant,uploaderId,runId,created}) {
  if (!admin || !created || !Array.isArray(created) || !runId ||
      !TEST_SLUGS.has(tenant?.slug) ||
      !/^[0-9a-f-]{36}$/i.test(String(tenant?.id)) ||
      !/^[0-9a-f-]{36}$/i.test(String(uploaderId))) {
    throw new Error('Refuse fixture generation outside the two explicit QA tenants');
  }
  const orgId=tenant.id;
  const record={
    tag:TAG,tenantSlug:tenant.slug,organizationId:orgId,runId,
    propertyId:randomUUID(),leaseId:randomUUID(),paymentId:randomUUID(),
    receiptId:randomUUID(),storagePath:null,
  };
  record.storagePath=[orgId,record.paymentId,uploaderId,randomUUID(),'comprobante.pdf'].join('/');
  // Registered before the first write. Cleanup is always called in finally.
  created.push(record);
  const pdf=createQaOnlyPdf('finance96 ' + tenant.slug);
  await insertRow(admin,'properties',{
    id:record.propertyId,organization_id:orgId,code:'QA96-'+record.propertyId,
    title:'QA ONLY - fictitious apartment',operation_type:'RENT',property_type:'APARTMENT',
    status:'DRAFT',currency:'COP',
  });
  await insertRow(admin,'leases',{
    id:record.leaseId,organization_id:orgId,property_id:record.propertyId,
    start_date:'2026-11-01',monthly_rent:1000,status:'DRAFT',
  });
  await insertRow(admin,'rent_payments',{
    id:record.paymentId,organization_id:orgId,lease_id:record.leaseId,
    period_month:'2026-11-01',expected_amount:1000,paid_amount:1,status:'PARTIAL',
    notes:TAG+' '+runId,
  });
  await insertRow(admin,'rent_receipts',{
    id:record.receiptId,organization_id:orgId,rent_payment_id:record.paymentId,
    idempotency_key:randomUUID(),amount:1,method:'CASH',support_reference:TAG+'-PDF',
    created_by:uploaderId,
  });
  const {error:uploadError} = await admin.storage.from(QA96_PRIVATE_BUCKET)
    .upload(record.storagePath,pdf,{upsert:false,contentType:'application/pdf'});
  if(uploadError) throw new Error('QA fixture Storage upload failed');
  await insertRow(admin,'rent_receipt_supports',{
    receipt_id:record.receiptId,organization_id:orgId,
    rent_payment_id:record.paymentId,storage_path:record.storagePath,
    mime_type:'application/pdf',size_bytes:pdf.length,uploaded_by:uploaderId,
  });
  return record.storagePath;
}

export async function cleanupQaReceiptFixtures({admin,created,runId,logger=console}) {
  if (!admin || !Array.isArray(created) || !runId) {
    throw new Error('QA fixture cleanup missing required arguments');
  }
  let failures=0;
  for(const r of [...created].reverse()) {
    if(r?.tag!==TAG || r.runId!==runId || !TEST_SLUGS.has(r.tenantSlug) ||
       !r.organizationId || !r.receiptId || !r.paymentId || !r.leaseId || !r.propertyId) {
      failures++;
      continue;
    }
    const deleteRow=async(table,id) => {
      try {
        const query=admin.from(table).delete().eq(
          table==='rent_receipt_supports'?'receipt_id':'id',id)
          .eq('organization_id',r.organizationId);
        const {error}=await query;
        if(error) failures++;
      } catch {failures++;}
    };
    await deleteRow('rent_receipt_supports',r.receiptId);
    if(r.storagePath && r.storagePath.startsWith(r.organizationId+'/')) {
      try {
        const {error}=await admin.storage.from(QA96_PRIVATE_BUCKET).remove([r.storagePath]);
        if(error) failures++;
      } catch {failures++;}
    } else {failures++;}
    await deleteRow('rent_receipts',r.receiptId);
    await deleteRow('rent_payments',r.paymentId);
    await deleteRow('leases',r.leaseId);
    await deleteRow('properties',r.propertyId);
  }
  logger.log('QA96 PDF FIXTURE CLEANUP: attempted='+created.length+', failures='+failures);
  if(failures) throw new Error('QA PDF fixture cleanup incomplete; inspect only marked QA96 artifacts in cloned project');
}
