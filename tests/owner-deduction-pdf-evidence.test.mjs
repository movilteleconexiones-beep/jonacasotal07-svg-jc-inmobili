import assert from 'node:assert/strict';
import test from 'node:test';
import { File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { deductionProofKind, deductionProofPrefix, DEDUCTION_PROOF_BUCKET } from '../src/core/owner-deduction-pdf.ts';
import { validateSignedLeasePdf } from '../src/core/signed-lease-pdf.ts';

const org='11111111-1111-4111-8111-111111111111';
const otherOrg='22222222-2222-4222-8222-222222222222';
const deduction='33333333-3333-4333-8333-333333333333';
const otherDeduction='44444444-4444-4444-8444-444444444444';
const fileId='55555555-5555-4555-8555-555555555555';
const doc={
  id:'66666666-6666-4666-8666-666666666666',
  organization_id:org,entity_type:'GENERAL',entity_id:deduction,
  document_type:'INVOICE',storage_bucket:DEDUCTION_PROOF_BUCKET,
  storage_path:deductionProofPrefix(org,deduction,'invoice')+fileId+'.pdf',
  title:'Factura o recibo del servicio · WATER',created_at:'2026-10-12T00:00:00Z',
};
const ledger=readFileSync(new URL('../src/modules/finance/OwnerDeductionLedger.tsx',import.meta.url),'utf8');
const evidence=readFileSync(new URL('../src/modules/finance/OwnerDeductionEvidence.tsx',import.meta.url),'utf8');

test('invoice and payment receipts are linked to one deduction in a single tenant',()=>{
  assert.equal(DEDUCTION_PROOF_BUCKET,'organization-documents');
  assert.equal(deductionProofKind(doc,org,deduction),'invoice');
  const payment={...doc,storage_path:deductionProofPrefix(org,deduction,'payment')+fileId+'.pdf'};
  assert.equal(deductionProofKind(payment,org,deduction),'payment');
  assert.equal(deductionProofKind(doc,otherOrg,deduction),null);
  assert.equal(deductionProofKind(doc,org,otherDeduction),null);
  for(const replacement of [
    {organization_id:otherOrg},{entity_type:'CONTACT'},{entity_id:otherDeduction},
    {document_type:'OTHER'},{storage_bucket:'propiedades'},
    {storage_path:deductionProofPrefix(otherOrg,deduction,'invoice')+fileId+'.pdf'},
    {storage_path:deductionProofPrefix(org,otherDeduction,'invoice')+fileId+'.pdf'},
    {storage_path:deductionProofPrefix(org,deduction,'invoice')+'../payment/'+fileId+'.pdf'},
    {storage_path:deductionProofPrefix(org,deduction,'invoice')+'name.pdf'},
  ])assert.equal(deductionProofKind({...doc,...replacement},org,deduction),null);
});

test('invoice and payment attachments accept only actual PDFs with the 10 MB limit',async()=>{
  assert.equal(await validateSignedLeasePdf(new File([Buffer.from('%PDF-1.7')],'agua.pdf',
    {type:'application/pdf'})),null);
  assert.match(await validateSignedLeasePdf(new File([Buffer.from('fake pdf')],'agua.pdf',
    {type:'application/pdf'}))??'',/cabecera PDF/);
  assert.match(await validateSignedLeasePdf(new File([],'pago.pdf',
    {type:'application/pdf'}))??'',/10 MB/);
  assert.match(await validateSignedLeasePdf(new File([Buffer.from('%PDF-1.7')],'pago.txt',
    {type:'text/plain'}))??'',/PDF/);
});

test('create a ledger deduction once, then attach optional PDFs without changing its payment state',()=>{
  assert.match(ledger,/name="invoice_pdf" type="file" accept="\.pdf,application\/pdf"/);
  assert.match(ledger,/name="payment_pdf" type="file" accept="\.pdf,application\/pdf"/);
  assert.match(ledger,/Número de factura o referencia \(opcional\)/);
  assert.match(ledger,/canUploadDocs=canReadDocs&&can\(PERMISSIONS\.DOCUMENTS_UPLOAD\)/);
  assert.match(ledger,/for\(const attachment of attachments\)\{[\s\S]*?validateSignedLeasePdf\(attachment\.file\)/);
  assert.match(ledger,/\.from\('owner_statement_deductions'\)\.insert\([\s\S]*?\}\)\.select\('id'\)\.single\(\)/);
  assert.match(ledger,/deductionId:record\.id/);
  assert.match(ledger,/let created=false/);
  assert.match(ledger,/created=true/);
  assert.match(ledger,/no crees otra deducción/i);
  assert.match(ledger,/OwnerDeductionEvidence/);
  assert.match(ledger,/line\.status!=='VOIDED'/);
  assert.doesNotMatch(evidence,/\.from\('owner_statement_deductions'\)\.update\(/);
});

test('private evidence uses organization-scoped storage and time-limited access only',()=>{
  assert.match(evidence,/validateSignedLeasePdf\(args\.file\)/);
  assert.match(evidence,/\.upload\(path, args\.file, \{/);
  assert.match(evidence,/upsert: false/);
  assert.match(evidence,/entity_type: 'GENERAL'/);
  assert.match(evidence,/entity_id: args\.deductionId/);
  assert.match(evidence,/document_type: 'INVOICE'/);
  assert.match(evidence,/uploaded_by: args\.userId/);
  assert.match(evidence,/\.eq\('organization_id', organizationId\)/);
  assert.match(evidence,/\.eq\('entity_id', deductionId\)/);
  assert.match(evidence,/deductionProofKind\(row, organizationId, deductionId\)/);
  assert.match(evidence,/createSignedUrl\(document\.storage_path, 60\)/);
  assert.doesNotMatch(evidence,/getPublicUrl|createPublicUrl|WOMPI_PRIVATE_KEY|status: 'PAID'/);
});

test('documents can be uploaded later only with read/upload accounting permissions',()=>{
  assert.match(ledger,/canReadDocs=can\(PERMISSIONS\.DOCUMENTS_VIEW\)/);
  assert.match(ledger,/canUpload=\{canUploadDocs&&writable&&editable&&line\.status!=='VOIDED'\}/);
  assert.match(evidence,/if \(!canUpload \|\| !userId \|\| busy\) return/);
  assert.match(evidence,/Adjuntar \/ ver PDFs/);
  assert.match(evidence,/Comprobante de pago \(PDF, máximo 10 MB\)/);
  assert.match(evidence,/Los PDFs son privados/);
});
