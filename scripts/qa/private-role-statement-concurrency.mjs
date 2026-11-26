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
const existing=await getPeriod();
assert.ok(existing && existing.status==='PAID' && Number(existing.paid_amount)===1234000);
const getStatements=async()=>checked(await admin.from('owner_statements').select('id,status,commission_amount,net_amount').eq('organization_id',org).eq('lease_id',lease.id).eq('period_month',period));
assert.equal((await getStatements()).length,0,'Reserved synthetic statement already exists');
const runId=randomUUID(), email='qa96-'+runId+'@example.invalid',password=randomBytes(32).toString('base64url');
const temporaryUntil=new Date(Date.now()+3600000).toISOString();
const record={userId:null,memberId:null};
let changedAccess=false, customRole=null;
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
  const roleName='QA203-RACE-'+runId;
  customRole=checked(await clients[0].rpc('create_custom_role',{target_org:org,role_name:roleName,role_description:'Synthetic concurrent permission test',permission_keys:['properties.view']}));
  const args={target_org:org,target_role:customRole,expected_permission_keys:['properties.view']};
  const desired=[['properties.view','clients.view'],['properties.view','deals.view']];
  const changes=await race((c,i)=>c.rpc('admin_update_role_permissions',{...args,desired_permission_keys:desired[i]}));
  assert.equal(changes.filter(r=>!r.error).length,1);
  assert.equal(changes.filter(r=>r.error?.code==='40001').length,1);
  const winner=changes.findIndex(r=>!r.error);
  const saved=checked(await admin.from('role_permissions').select('permissions(key)').eq('role_id',customRole)).map(r=>r.permissions.key).sort();
  assert.deepEqual(saved,[...desired[winner]].sort());
  console.log('Concurrent stale role update rejected, winner preserved PASS');
  const statementArgs={target_org:org,target_lease:lease.id,target_month:period,agency_commission_percentage:10,withholding_tax:0};
  const statements=await race(c=>c.rpc('create_owner_draft_statement_by_percentage',statementArgs));
  assert.equal(statements.filter(r=>!r.error).length,1);
  assert.equal(statements.filter(r=>r.error?.code==='23505').length,1);
  const rows=await getStatements();
  assert.equal(rows.length,1);
  assert.equal(rows[0].status,'DRAFT');
  assert.equal(Number(rows[0].commission_amount),123400);
  assert.equal(Number(rows[0].net_amount),1110600);
  console.log('Concurrent duplicate settlement rejected, exact net PASS');
} finally {
  try {
    if(customRole){
      const role=checked(await admin.from('roles').select('id,name,organization_id').eq('id',customRole).eq('organization_id',org).single());
      assert.equal(role.name,'QA203-RACE-'+runId);
      checked(await admin.from('roles').update({active:false}).eq('id',customRole).eq('organization_id',org).select('id').single());
    }
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
}
console.log('Synthetic role and statement retained for evidence, QA account disabled, temporary access restored');
