import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  QA96_PRIVATE_BUCKET, createQaOnlyPdf, createQaReceiptFixture,
  cleanupQaReceiptFixtures,
} from '../scripts/qa/finance96-pdf-fixtures.mjs';

const TENANT = {slug:'qa-finance-96-foreign-20261113',
  id:'f9f5338e-0b01-47db-8856-96cf8f221c55'};
const USER = '77777777-7777-4777-8777-777777777777';
const RUN = 'synthetic-unit-run';

function fakeAdmin({failInsert=null,failDelete=null}={}) {
  const events=[];
  const chain = {
    eq(key,val){events.push(['scope',key,val]);return this;},
    then(resolve,reject){return Promise.resolve({error:failDelete?{code:'E_QA'}:null}).then(resolve,reject);},
  };
  const admin={
    from(table) {
      return {
        async insert(row){
          events.push(['insert',table,row]);
          return {error:table===failInsert?{code:'E_QA'}:null};
        },
        delete(){events.push(['delete',table]);return chain;},
      };
    },
    storage:{
      from(bucket) {
        assert.equal(bucket,QA96_PRIVATE_BUCKET);
        return {
          async upload(path,bytes,options){
            events.push(['upload',path,bytes,options]);
            return {error:null};
          },
          async remove(paths){
            events.push(['remove',paths]);
            return {error:null};
          },
        };
      },
    },
  };
  return {admin,events};
}

test('#96 generated PDF is a real one-page PDF with no real user data',()=>{
  const data=createQaOnlyPdf('finance96 tenant ficticio');
  assert.equal(data.subarray(0,5).toString('ascii'),'%PDF-');
  const source=data.toString('ascii');
  assert.match(source,/\/Type \/Page\b/);
  assert.match(source,/xref\n0 6\n/);
  assert.match(source,/startxref\n\d+\n%%EOF/);
  assert.match(source,/QA ONLY - NO REAL RECEIPT/);
  assert.ok(data.length>100 && data.length<10_000);
});

test('#96 PDF fixture refuses unknown or non-test organizations',async()=>{
  const f=fakeAdmin();
  await assert.rejects(createQaReceiptFixture({
    admin:f.admin,tenant:{...TENANT,slug:'jco-inmodigital-global'},
    uploaderId:USER,runId:RUN,created:[],
  }),/Refuse fixture generation/);
  assert.equal(f.events.length,0);
});

test('#96 creates true linked fictitious receipt/Storage metadata in correct order',async()=>{
  const f=fakeAdmin(),created=[];
  const path=await createQaReceiptFixture({
    admin:f.admin,tenant:TENANT,uploaderId:USER,runId:RUN,created,
  });
  assert.equal(created.length,1);
  assert.ok(path.startsWith(TENANT.id+'/'));
  assert.ok(path.includes('/'+USER+'/'));
  assert.ok(path.endsWith('/comprobante.pdf'));
  assert.deepEqual(f.events.filter(x=>x[0]==='insert').map(x=>x[1]),
    ['properties','leases','rent_payments','rent_receipts','rent_receipt_supports']);
  const storagePosition=f.events.findIndex(x=>x[0]==='upload');
  const supportPosition=f.events.findIndex(x=>x[0]==='insert' && x[1]==='rent_receipt_supports');
  assert.ok(storagePosition>0 && storagePosition<supportPosition);
  assert.equal(f.events[storagePosition][3].contentType,'application/pdf');
  assert.equal(f.events[storagePosition][3].upsert,false);
  const support=f.events[supportPosition][2];
  assert.equal(support.rent_payment_id,created[0].paymentId);
  assert.equal(support.receipt_id,created[0].receiptId);
  assert.equal(support.organization_id,TENANT.id);
  assert.equal(support.size_bytes, f.events[storagePosition][2].length);
  assert.equal(support.uploaded_by,USER);

  await cleanupQaReceiptFixtures({admin:f.admin,created,runId:RUN,
    logger:{log(){}},
  });
  const deletions=f.events.filter(x=>x[0]==='delete').map(x=>x[1]);
  assert.deepEqual(deletions,
    ['rent_receipt_supports','rent_receipts','rent_payments','leases','properties']);
  assert.equal(f.events.filter(x=>x[0]==='remove').length,1);
});

test('#96 cleanup knows all generated IDs before an incomplete insert fails',async()=>{
  const f=fakeAdmin({failInsert:'rent_payments'}),created=[];
  await assert.rejects(createQaReceiptFixture({
    admin:f.admin,tenant:TENANT,uploaderId:USER,runId:RUN,created,
  }),/rent_payments/);
  assert.equal(created.length,1);
  assert.ok(created[0].receiptId && created[0].paymentId &&
    created[0].leaseId && created[0].propertyId && created[0].storagePath);
  await cleanupQaReceiptFixtures({admin:f.admin,created,runId:RUN,
    logger:{log(){}},
  });
  assert.ok(f.events.some(x=>x[0]==='delete' && x[1]==='properties'));
});

test('#96 cleanup rejects a fixture from another QA run without deleting',async()=>{
  const f=fakeAdmin(),created=[{
    tag:'QA96-ONLY',tenantSlug:TENANT.slug,organizationId:TENANT.id,
    receiptId:'x',paymentId:'y',leaseId:'z',propertyId:'w',runId:'foreign-run',
    storagePath:TENANT.id+'/fake/comprobante.pdf',
  }];
  await assert.rejects(cleanupQaReceiptFixtures({
    admin:f.admin,created,runId:RUN,logger:{log(){}},
  }),/cleanup incomplete/);
  assert.equal(f.events.length,0);
});

test('#96 cleanup reports errors rather than claiming success',async()=>{
  const f=fakeAdmin({failDelete:true}),created=[];
  await createQaReceiptFixture({admin:f.admin,tenant:TENANT,uploaderId:USER,runId:RUN,created});
  await assert.rejects(cleanupQaReceiptFixtures({
    admin:f.admin,created,runId:RUN,logger:{log(){}},
  }),/cleanup incomplete/);
});
