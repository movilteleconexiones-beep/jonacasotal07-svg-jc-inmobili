import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {addTemporaryQaMember} from './finance96-membership.mjs';

const clone='https://zjgstfgiirgjssnihaam.supabase.co';
assert.equal(process.env.JCO_QA96_SUPABASE_URL,clone);
assert.ok(process.env.JCO_QA96_SECRET_KEY && process.env.JCO_QA96_PUBLISHABLE_KEY);
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(clone,process.env.JCO_QA96_SECRET_KEY,options);
const checked=r=>{if(r.error)throw Error(String(r.error.code));return r.data;};
const org=checked(await admin.from('organizations').select('id').eq('slug','sistema-inmobiliario-jco').single()).id;
const original=checked(await admin.from('organization_billing_access').select('is_test,manual_access_until').eq('organization_id',org).single());
assert.equal(original.is_test,true);
const lease=checked(await admin.from('leases').select('id,status,start_date').eq('organization_id',org).eq('contract_number','QA203-UI-RENT').single());
assert.equal(lease.status,'ACTIVE');
const period='2026-10-01';
assert.equal(lease.start_date,period);
const getPeriod=async()=>checked(await admin.from('rent_payments').select('id,expected_amount,paid_amount,status').eq('organization_id',org).eq('lease_id',lease.id).eq('period_month',period).maybeSingle());
assert.equal(await getPeriod(),null,'Reserved synthetic test month already used; refuse to modify existing records');
const runId=randomUUID(), email='qa96-'+runId+'@example.invalid',password=randomBytes(32).toString('base64url');
const temporaryUntil=new Date(Date.now()+3600000).toISOString();
const record={userId:null,memberId:null};
let changedAccess=false;
try {
  let q=admin.from('organization_billing_access').update({manual_access_until:temporaryUntil}).eq('organization_id',org).eq('is_test',true);
  q=original.manual_access_until===null?q.is('manual_access_until',null):q.eq('manual_access_until',original.manual_access_until);
  const updated=checked(await q.select('manual_access_until').single());
  changedAccess=true;
  assert.equal(Date.parse(updated.manual_access_until),Date.parse(temporaryUntil));
  const role=checked(await admin.from('roles').select('id').eq('organization_id',org).eq('key','ADMIN').eq('active',true).single());
  const {user}=checked(await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{qa_suite:'finance96',qa_run:runId}}));
  record.userId=user.id;
  await addTemporaryQaMember({admin,orgId:org,userId:user.id,roleId:role.id,record});
  const clients=[0,1].map(()=>createClient(clone,process.env.JCO_QA96_PUBLISHABLE_KEY,options));
  const sessions=await Promise.all(clients.map(c=>c.auth.signInWithPassword({email,password})));
  const tokens=sessions.map(s=>checked(s).session.access_token);
  assert.ok(tokens.every(Boolean));
  assert.notEqual(tokens[0],tokens[1],'Two distinct signed sessions required');
  const race=async(fn)=>Promise.all(clients.map((c,i)=>fn(c,i)));
  const args={target_org:org,target_lease:lease.id,target_period:period};
  const periods=await race(c=>c.rpc('create_tenant_rent_period',args));
  assert.equal(periods.filter(r=>!r.error).length,1);
  assert.equal(periods.filter(r=>r.error?.code==='23505').length,1);
  const payment=await getPeriod();
  assert.ok(payment && Number(payment.paid_amount)===0);
  console.log('Concurrent duplicate rent period: exactly one row PASS');
  const expected=Number(payment.expected_amount),amount=Math.floor(expected*0.75*100)/100;
  assert.ok(amount*2>expected && amount<expected);
  const payload={target_org:org,target_payment:payment.id,receipt_amount:amount,receipt_method:'CASH',receipt_reference:'QA203-RACE-'+runId};
  const receipts=await race(c=>c.rpc('record_tenant_rent_receipt',{...payload,request_key:randomUUID()}));
  assert.equal(receipts.filter(r=>!r.error).length,1);
  assert.equal(receipts.filter(r=>r.error?.code==='23514').length,1);
  assert.equal(Number((await getPeriod()).paid_amount),amount);
  console.log('Concurrent excessive combined receipts: one rejected PASS');
  const remainder=Math.round((expected-amount)*100)/100;
  const retry={...payload,receipt_amount:remainder,receipt_reference:'QA203-RETRY-'+runId,request_key:randomUUID()};
  const repeated=await race(c=>c.rpc('record_tenant_rent_receipt',retry));
  const ids=repeated.map(checked);
  assert.equal(ids[0],ids[1]);
  const final=await getPeriod();
  assert.equal(Number(final.paid_amount),expected);assert.equal(final.status,'PAID');
  const ledger=checked(await admin.from('rent_receipts').select('id,amount').eq('organization_id',org).eq('rent_payment_id',payment.id));
  assert.equal(ledger.length,2);
  assert.equal(Math.round(ledger.reduce((n,r)=>n+Number(r.amount),0)*100),Math.round(expected*100));
  console.log('Concurrent identical retry: one receipt, consistent ledger PASS');
} finally {
  try {
    if(record.userId){
      const {user}=checked(await admin.auth.admin.getUserById(record.userId));
      assert.equal(user.app_metadata.qa_run,runId);
      checked(await admin.auth.admin.updateUserById(user.id,{ban_duration:'876000h'}));
      if(record.memberId)checked(await admin.from('organization_members').delete().eq('organization_id',org).eq('id',record.memberId).eq('user_id',user.id));
      assert.equal(checked(await admin.from('organization_members').select('id').eq('organization_id',org).eq('user_id',user.id)).length,0);
    }
  } finally {
    if(changedAccess)checked(await admin.from('organization_billing_access').update({manual_access_until:original.manual_access_until}).eq('organization_id',org).eq('is_test',true).eq('manual_access_until',temporaryUntil).select('organization_id').single());
  }
}
console.log('Synthetic ledger retained for evidence, QA account disabled, temporary access restored');
