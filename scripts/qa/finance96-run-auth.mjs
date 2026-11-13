/**
 * INMOJCO #96: one-shot real Auth QA certification against the RESTORED CLONE.
 *
 * This runner creates 5 temporary Supabase Auth accounts with the Admin API,
 * assigns one QA-only tenant role to each, invokes the existing real-JWT
 * acceptance probe, and removes ONLY the accounts created by this run.
 *
 * It never provisions in production; secrets and credentials stay in memory.
 * Private PDF fixtures are prerequisites. No bank/payment write is attempted.
 *
 * Usage (private terminal only):
 *   JCO_QA96_PROVISION=1 ... node scripts/qa/finance96-run-auth.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const CLONE_ORIGIN = 'https://zjgstfgiirgjssnihaam.supabase.co';
const PRIMARY_SLUG = 'sistema-inmobiliario-jco';
const FOREIGN_SLUG = 'qa-finance-96-foreign-20261113';
const BUCKET = 'jco-rent-receipts-private';
const ROLES = [
  ['ORGANIZATION_OWNER', 'OWNER'],
  ['ADMIN', 'ADMIN'],
  ['MANAGER', 'MANAGER'],
  ['AGENT', 'AGENT'],
  ['CLIENT', 'CLIENT'],
];

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, 'Missing protected QA value: ' + name);
  return value;
}

function checked(data, error, label) {
  assert.ifError(error && new Error(label + ': ' + error.code));
  assert.ok(data != null, label + ': no rows');
  return data;
}

function onlyTestTenants(rows) {
  assert.equal(rows.length, 2, 'Expected exactly two known QA organizations');
  const bySlug = new Map(rows.map(o => [o.slug, o]));
  const own = bySlug.get(PRIMARY_SLUG);
  const foreign = bySlug.get(FOREIGN_SLUG);
  assert.ok(own && foreign && own.id !== foreign.id, 'Wrong QA organizations');
  assert.equal(own.status, 'ACTIVE', 'Primary QA organization must be active');
  assert.ok(foreign.status === 'ACTIVE' || foreign.status === 'INACTIVE',
    'Foreign organization status differs from QA fixture');
  return {own,foreign};
}

async function assertPdf(client, path, orgId) {
  assert.ok(path.startsWith(orgId + '/') && path.endsWith('/comprobante.pdf'),
    'PDF path must be scoped to the correct test organization');
  const {data,error} = await client.storage.from(BUCKET).download(path);
  checked(data,error,'QA private PDF');
  const bytes = Buffer.from(await data.arrayBuffer());
  assert.ok(bytes.length > 10 && bytes.subarray(0,5).toString() === '%PDF-',
    'QA fixture must contain authentic PDF bytes');
}

async function preflight(admin, ownPath, foreignPath) {
  const {data:organizations,error:orgError} = await admin
    .from('organizations').select('id,slug,status')
    .in('slug',[PRIMARY_SLUG,FOREIGN_SLUG]);
  const {own,foreign} = onlyTestTenants(checked(organizations,orgError,'organization lookup'));
  const ids = [own.id, foreign.id];
  const {data:billing,error:billingError} = await admin
    .from('organization_billing_access')
    .select('organization_id,is_test,requires_payment').in('organization_id',ids);
  checked(billing,billingError,'billing test flags');
  assert.equal(billing.length,2,'Both test access entries must exist');
  for (const b of billing) assert.equal(b.is_test,true,'Refuse non-test tenant');
  assert.equal(billing.find(b => b.organization_id === foreign.id)?.requires_payment,false,
    'Foreign fixture must not have a billable license');
  const {data:roleDefs,error:rolesError} = await admin
    .from('roles').select('id,key,organization_id,active')
    .eq('organization_id',own.id).eq('active',true)
    .in('key',ROLES.map(([key]) => key));
  checked(roleDefs,rolesError,'active role definitions');
  assert.equal(new Set(roleDefs.map(x=>x.key)).size,5,
    'All five distinct organization roles must exist');
  const byRole = new Map(roleDefs.map(x => [x.key,x.id]));
  // Preflight BEFORE creating a single Auth user: validate PDFs and their
  // linked receipt/payment rows to avoid orphaned accounts on a missing fixture.
  assert.notEqual(ownPath,foreignPath,'Receipt paths must be different');
  await assertPdf(admin,ownPath,own.id);
  await assertPdf(admin,foreignPath,foreign.id);
  const {data:supports,error:supportError} = await admin
    .from('rent_receipt_supports')
    .select('organization_id,rent_payment_id,storage_path,mime_type,size_bytes')
    .in('storage_path',[ownPath,foreignPath]);
  checked(supports,supportError,'finance support records');
  assert.equal(supports.length,2,'Both PDF support records must exist');
  for(const s of supports) {
    const correctOrg = s.storage_path === ownPath ? own.id : foreign.id;
    assert.equal(s.organization_id,correctOrg,'Support crosses organizations');
    assert.equal(s.mime_type,'application/pdf','Support not registered as PDF');
    assert.ok(Number(s.size_bytes)>10,'Empty receipt support');
  }
  const {data:payments,error:paymentError} = await admin
    .from('rent_payments').select('id,organization_id')
    .in('id',supports.map(x=>x.rent_payment_id));
  checked(payments,paymentError,'rent period fixture');
  assert.equal(payments.length,2,'Expected two real test periods');
  for(const support of supports) {
    assert.ok(payments.some(p => p.id === support.rent_payment_id &&
      p.organization_id === support.organization_id),
      'Receipt support does not match its tenant period');
  }
  return {own,foreign,byRole};
}

async function spawnAcceptance(env) {
  const cwd = fileURLToPath(new URL('../../',import.meta.url));
  const status = await new Promise((resolve,reject)=>{
    const child = spawn(process.execPath,
      ['--test','tests/finance-real-auth-96.test.mjs'],
      {cwd,env,stdio:'inherit',shell:false});
    child.once('error',reject);
    child.once('exit',(code,signal)=>{
      if(signal) reject(new Error('QA test terminated by signal'));
      else resolve(code);
    });
  });
  assert.equal(status,0,'Authentic QA certification failed');
}

async function cleanup(admin,created,orgId) {
  let failures=0;
  for(const item of [...created].reverse()) {
    try {
      if(item.memberId) {
        const {error} = await admin.from('organization_members').delete()
          .eq('id',item.memberId).eq('organization_id',orgId).eq('user_id',item.userId);
        if(error) throw new Error('QA membership deletion failed');
      }
      // User IDs are generated during THIS run; no existing account is touched.
      const {error} = await admin.auth.admin.deleteUser(item.userId);
      if(error) throw new Error('QA Auth deletion failed');
    } catch {
      failures++;
      // Fail closed: never silently report cleanup as successful.
    }
  }
  console.log('QA96 CLEANUP: attempted=' + created.length + ', failures=' + failures);
  if(failures) throw new Error('QA cleanup incomplete; inspect clone-only run markers');
}

async function main() {
  assert.equal(process.env.JCO_QA96_PROVISION,'1',
    'Disabled by default; explicit QA opt-in required');
  assert.equal(new URL(required('JCO_QA96_SUPABASE_URL')).origin,CLONE_ORIGIN,
    'Refuse any production, staging or unexpected Supabase project');
  const key = required('JCO_QA96_SECRET_KEY');
  const publicKey = required('JCO_QA96_PUBLISHABLE_KEY');
  const ownPath = required('JCO_QA96_PRIVATE_PDF_PATH');
  const foreignPath = required('JCO_QA96_OTHER_PRIVATE_PDF_PATH');
  const admin = createClient(CLONE_ORIGIN,key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  });
  const {own,foreign,byRole} = await preflight(admin,ownPath,foreignPath);
  const created = [];
  let error = null;
  const runId = randomUUID();
  const env = {
    PATH:process.env.PATH || '', HOME:process.env.HOME || '',
    JCO_QA96_RUN_REAL_AUTH:'1', JCO_QA96_SUPABASE_URL:CLONE_ORIGIN,
    JCO_QA96_PUBLISHABLE_KEY:publicKey, JCO_QA96_SECRET_KEY:key,
    JCO_QA96_TEST_ORG_ID:own.id,
    JCO_QA96_OTHER_ORG_ID:foreign.id,
    JCO_QA96_PRIVATE_PDF_PATH:ownPath,
    JCO_QA96_OTHER_PRIVATE_PDF_PATH:foreignPath,
  };
  try {
    for(const [role,suffix] of ROLES) {
      const email = 'qa96-' + suffix.toLowerCase() + '-' +
        randomUUID().slice(0,12) + '@example.invalid';
      const password = randomBytes(32).toString('base64url');
      const {data:createdUser,error:createError} =
        await admin.auth.admin.createUser({
          email,password,email_confirm:true,
          app_metadata:{qa_suite:'finance96',qa_run:runId},
        });
      const user = checked(createdUser?.user,createError,'Auth admin createUser');
      const record = {userId:user.id,memberId:null};
      created.push(record);
      const {data:member,error:memberError} = await admin
        .from('organization_members')
        .insert({organization_id:own.id,user_id:user.id,status:'ACTIVE'})
        .select('id').single();
      checked(member,memberError,'QA membership creation');
      record.memberId=member.id;
      const {error:roleError} = await admin
        .from('member_roles')
        .insert({organization_member_id:member.id,role_id:byRole.get(role)});
      assert.ifError(roleError && new Error('QA role assignment failed'));
      env['JCO_QA96_' + suffix + '_EMAIL']=email;
      env['JCO_QA96_' + suffix + '_PASSWORD']=password;
    }
    assert.equal(created.length,5,'Exactly five temporary test users required');
    await spawnAcceptance(env);
    console.log('QA96 CERTIFICATION: real Auth/PostgREST/Storage checks completed');
  } catch (e) {
    error=e;
  } finally {
    try {await cleanup(admin,created,own.id);}
    catch(e) {error=error ? new AggregateError([error,e],'QA and cleanup failed'):e;}
  }
  if(error) throw error;
}

main().catch(err=>{
  console.error('QA96 FAIL (no credentials printed):',err?.message || 'Unknown failure');
  process.exitCode=1;
});
