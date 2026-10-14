import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 RENT_RECEIPT_EVIDENCE_BUCKET,RENT_RECEIPT_EVIDENCE_MAX_BYTES,
 receiptEvidencePath,validateRentReceiptEvidence,
} from '../src/core/rent-receipt-evidence.ts';

const ui=readFileSync(new URL('../src/modules/finance/TenantRentEntry.tsx',import.meta.url),'utf8');
const history=readFileSync(new URL('../src/modules/finance/RentReceiptEvidenceHistory.tsx',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261014082000_private_rent_receipt_supports.sql',import.meta.url),'utf8');
const id=(n)=>n+'1111111-1111-4111-8111-111111111111'.slice(n.length);
const org='11111111-1111-4111-8111-111111111111';
const payment='22222222-2222-4222-8222-222222222222';
const actor='33333333-3333-4333-8333-333333333333';
const key='44444444-4444-4444-8444-444444444444';

test('payment proof path is predictable for retry but not based on a user filename',()=>{
 assert.equal(RENT_RECEIPT_EVIDENCE_BUCKET,'jco-rent-receipts-private');
 assert.equal(RENT_RECEIPT_EVIDENCE_MAX_BYTES,10485760);
 assert.equal(receiptEvidencePath(org,payment,actor,key,'application/pdf'),
   org+'/'+payment+'/'+actor+'/'+key+'/comprobante.pdf');
 assert.equal(receiptEvidencePath(org,payment,actor,key,'image/jpeg').split('/').at(-1),'comprobante.jpg');
 assert.throws(()=>receiptEvidencePath('../',payment,actor,key,'application/pdf'));
});

test('proof validator checks actual JPG PNG WEBP and PDF signatures',async()=>{
 const cases=[
  ['evidence.jpg','image/jpeg',[0xff,0xd8,0xff,0x00,0x04,0x05,0x06,0x07]],
  ['evidence.png','image/png',[137,80,78,71,13,10,26,10]],
  ['evidence.webp','image/webp',[82,73,70,70,9,0,0,0,87,69,66,80]],
  ['evidence.pdf','application/pdf',[37,80,68,70,45,49,46,55]],
 ];
 for(const [name,mime,bytes] of cases){
   const file=new File([new Uint8Array(bytes)],name,{type:mime});
   assert.equal((await validateRentReceiptEvidence(file)).error,null,name);
 }
 const html=new File(['<html>unsafe</html>'],'evidence.pdf',{type:'application/pdf'});
 assert.match((await validateRentReceiptEvidence(html)).error,/contenido no corresponde/);
 const oversized=new File([new Uint8Array(RENT_RECEIPT_EVIDENCE_MAX_BYTES+1)],'huge.pdf',{type:'application/pdf'});
 assert.match((await validateRentReceiptEvidence(oversized)).error,/10 MB/);
 const incorrect=new File(['not pdf'],'fake.html',{type:'text/html'});
 assert.notEqual((await validateRentReceiptEvidence(incorrect)).error,null);
});

test('photo or PDF uploaded before the immutable receipt is credited',()=>{
 assert.match(ui,/name="evidence" type="file"/);
 assert.match(ui,/accept="\.jpg,\.jpeg,\.png,\.webp,\.pdf/);
 assert.match(ui,/validateRentReceiptEvidence\(file\)/);
 assert.ok(ui.indexOf('.upload(path,file,')<ui.indexOf("supabase.rpc('record_tenant_rent_receipt_with_evidence'"));
 assert.match(ui,/evidence_path:evidencePath/);
 assert.match(ui,/uploadedPath\?:string/);
 assert.match(ui,/request\.uploadedPath=path/);
 assert.match(ui,/fileFingerprint/);
 assert.match(ui,/pendingReceiptRequest\.current=null/);
 assert.match(ui,/if\(uploadError\)/);
 assert.match(ui,/if\(failure\|\|!receiptId\)/);
});

test('supports are read-only and private even after receipt credit',()=>{
 assert.match(sql,/CREATE TABLE public\.rent_receipt_supports/);
 assert.match(sql,/receipt_id uuid PRIMARY KEY REFERENCES public\.rent_receipts/);
 assert.match(sql,/REVOKE ALL ON public\.rent_receipt_supports FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/GRANT SELECT ON public\.rent_receipt_supports TO authenticated/);
 assert.match(sql,/has_org_permission\(organization_id,'rent_payments.view'\)/);
 assert.match(sql,/jco_rent_supports_storage_insert/);
 assert.match(sql,/jco_rent_supports_storage_read/);
 assert.match(sql,/jco_rent_supports_storage_unlinked_cleanup/);
 assert.match(sql,/NOT EXISTS \(\s*SELECT 1 FROM public\.rent_receipt_supports rs WHERE rs\.storage_path=name/);
 assert.match(sql,/record_tenant_rent_receipt_with_evidence/);
 assert.match(sql,/record_tenant_rent_receipt\(target_org,target_payment/);
 assert.match(sql,/Idempotency key belongs to a different proof/);
 assert.match(history,/createSignedUrl\(support\.storage_path,60\)/);
 assert.match(history,/can\(PERMISSIONS\.RENT_PAYMENTS_VIEW\)/);
 assert.match(history,/Ver comprobante/);
 assert.doesNotMatch(ui,/getPublicUrl\(/);
 assert.doesNotMatch(history,/getPublicUrl\(/);
});
