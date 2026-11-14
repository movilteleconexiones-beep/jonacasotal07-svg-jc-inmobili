import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { evaluateReleaseReadiness, PRODUCTION_PROJECT_REF } from '../scripts/release-readiness.mjs';

const sha = 'a'.repeat(40);
const now = new Date('2030-03-10T12:00:00.000Z');
function completeEvidence() {
  return {
    project_ref: PRODUCTION_PROJECT_REF,
    commit_sha: sha,
    ci: { passed: true, commit_sha: sha },
    database: {
      migrations_reviewed: true,
      backup_sha256: 'b'.repeat(64),
      restored_backup_sha256: 'b'.repeat(64),
      restore_target: 'local:inmojco-recovery-ci',
      backup_created_at: '2030-03-10T08:00:00.000Z',
      backup_restored_isolated: true,
      storage_objects_restored: true,
      restore_verified_at: '2030-03-10T10:00:00.000Z',
    },
    security: {
      agency_a_b_isolation: true,
      client_and_staff_permissions: true,
      platform_admin_exclusive: true,
      external_owner_tenant: true,
    },
    deployment: {
      rollback_reviewed: true,
      window_confirmed: true,
      wompi_mode: 'sandbox',
    },
  };
}
const readiness = (e, extra) => evaluateReleaseReadiness(e, {now,expectedCommit:sha,...extra});

test('release blocks by default: no evidence cannot publish changes', () => {
  const result = readiness(undefined);
  assert.equal(result.ready,false);
  assert.match(result.errors.join(' '), /respaldo|restauración/i);
  assert.match(result.errors.join(' '), /SuperAdmin/i);
  assert.match(result.errors.join(' '), /Supabase/i);
});

test('only an exact, recent and independently checked deployment checklist passes', () => {
  assert.deepEqual(readiness(completeEvidence()), { ready:true,phase:'integration',errors:[] });
});

test('wrong Supabase instance, mismatched CI SHA or missing external tenant check always block', () => {
  const wrong = completeEvidence(); wrong.project_ref='nqzopzhmhqdssgpljypu';
  assert.equal(readiness(wrong).ready,false);
  const staleCommit=completeEvidence(); staleCommit.ci.commit_sha='c'.repeat(40);
  assert.equal(readiness(staleCommit).ready,false);
  const changedHead=completeEvidence(); changedHead.commit_sha='c'.repeat(40);
  assert.equal(readiness(changedHead).ready,false);
  const missing=completeEvidence();missing.security.external_owner_tenant=false;
  assert.equal(readiness(missing).ready,false);
});

test('an old backup, expired restore, or restore predating the backup cannot authorize release', () => {
  const backup=completeEvidence();backup.database.backup_created_at='2030-03-08T10:00:00Z';
  assert.equal(readiness(backup).ready,false);
  const restore=completeEvidence();restore.database.restore_verified_at='2030-02-21T10:00:00Z';
  assert.equal(readiness(restore).ready,false);
  const reversed=completeEvidence();reversed.database.restore_verified_at='2030-03-10T07:00:00Z';
  assert.match(readiness(reversed).errors.join(' '), /posterior al respaldo reciente/);
  const future=completeEvidence();future.database.backup_created_at='2030-03-11T10:00:00Z';
  assert.equal(readiness(future).ready,false);
});

test('a restored database without actual contract and photo files is not enough', () => {
  const evidence=completeEvidence();
  evidence.database.storage_objects_restored=false;
  const result=readiness(evidence);
  assert.equal(result.ready,false);
  assert.match(result.errors.join(' '), /Storage/);
});

test('recovery must use the exact backup file hash, not merely a later timestamp', () => {
  const mismatched=completeEvidence();
  mismatched.database.restored_backup_sha256='f'.repeat(64);
  assert.match(readiness(mismatched).errors.join(' '), /SHA-256 del respaldo/);
  const missing=completeEvidence();
  delete missing.database.restored_backup_sha256;
  assert.equal(readiness(missing).ready,false);
  const equivalentWindowsHex=completeEvidence();
  equivalentWindowsHex.database.restored_backup_sha256='B'.repeat(64);
  assert.equal(readiness(equivalentWindowsHex).ready,true);
});

test('the restored database must be isolated from production', () => {
  const missing=completeEvidence();
  delete missing.database.restore_target;
  assert.equal(readiness(missing).ready,false);
  const production=completeEvidence();
  production.database.restore_target='staging:'+PRODUCTION_PROJECT_REF;
  assert.match(readiness(production).errors.join(' '), /distinto a producción/);
  const malformed=completeEvidence();
  malformed.database.restore_target='https://db.cuitgyqrjibgwuniapmk.supabase.co';
  assert.equal(readiness(malformed).ready,false);
  const isolated=completeEvidence();
  isolated.database.restore_target='staging:backup-lab-01';
  assert.equal(readiness(isolated).ready,true);
});

test('sandbox is mandatory for PR phase and commercial launch has stricter gates', () => {
  const commercial=completeEvidence();
  assert.equal(readiness(commercial,{phase:'commercial'}).ready,false);
  assert.match(readiness(commercial,{phase:'commercial'}).errors.join(' '), /Wompi real/);
  commercial.deployment.wompi_mode='production';
  commercial.security.real_auth_five_role_browser=true;
  commercial.security.financial_rpc_authorization_reviewed=true;
  commercial.database.storage_binary_sha256_verified=true;
  commercial.deployment.production_smoke_verified=true;
  commercial.deployment.rollback_rehearsed=true;
  commercial.legal={
    consumer_terms_approved:true,
    buyer_acceptance_verified:true,
    policies:[
      { slug:'sistema-inmobiliario-jco',
        url:'https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf',
        sha256:'d'.repeat(64), version:'1.0',
        signed_adoption_act:true, pdf_sha256_matches_published_bytes:true,
        pdf_verified_at:'2030-03-10T11:00:00.000Z', approved_at:'2030-03-09T12:00:00Z' },
      { slug:'jco-inmodigital-global',
        url:'https://www.inmojco.com/politicas/jco-inmodigital-global.pdf',
        sha256:'e'.repeat(64), version:'1.0',
        signed_adoption_act:true, pdf_sha256_matches_published_bytes:true,
        pdf_verified_at:'2030-03-10T11:00:00.000Z', approved_at:'2030-03-09T12:00:00Z' },
    ],
  };
  commercial.commercial={
    approved_environment:'production',
    approved_order_status:'APPROVED',
    approved_fulfillment_status:'APPLIED',
    production_signed_payment_verified:true,
    production_fulfillment_applied:true,
    production_license_activated:true,
    payment_idempotency_verified:true,
    renewal_and_suspension_verified:true,
    financial_flows_verified:true,
    smtp_invitation_recovery:true,
    wompi_sandbox_signed:true,
    wompi_real_approved:true,
    licensing_is_superadmin_only:true,
    private_financial_browser_e2e:true,
    shared_owner_financial_browser_e2e:true,
    commission_118_documented:true,
    public_crm_consent_e2e:true,
    consignment_private_photo_e2e:true,
  };
  assert.equal(readiness(commercial,{phase:'commercial'}).ready,true);
  commercial.commercial.approved_environment='sandbox';
  assert.equal(readiness(commercial,{phase:'commercial'}).ready,false);
  commercial.commercial.approved_environment='production';

  assert.equal(readiness(commercial,{phase:'commercial'}).ready,true);
  assert.equal(readiness(commercial,{phase:'integration'}).ready,false);
  commercial.commercial.wompi_real_approved=false;
  assert.equal(readiness(commercial,{phase:'commercial'}).ready,false);
});

test('G17: signed legal evidence is mandatory, never inferred from Wompi APPROVED',()=>{
  const data=completeEvidence();
  data.deployment.wompi_mode='production';
  data.commercial={approved_environment:'production',approved_order_status:'APPROVED',
    approved_fulfillment_status:'APPLIED'};
  const result=readiness(data,{phase:'commercial'});
  assert.equal(result.ready,false);
  assert.match(result.errors.join(' '),/políticas jurídicas aprobadas/);
});

test('G17: verify identity, document hash, signed act and canonical URL for each policy',()=>{
  const src=completeEvidence();
  src.deployment.wompi_mode='production';
  const policy=(slug)=>({
    slug,url:'https://www.inmojco.com/politicas/'+slug+'.pdf',sha256:'f'.repeat(64),
    version:'1.0',signed_adoption_act:true,pdf_sha256_matches_published_bytes:true,
    approved_at:'2030-03-09T12:00:00Z',pdf_verified_at:'2030-03-10T11:00:00Z',
  });
  src.legal={consumer_terms_approved:true,buyer_acceptance_verified:true,policies:[
    policy('sistema-inmobiliario-jco'),policy('jco-inmodigital-global')]};
  // The other commercial gates remain missing in this unit; focus only on
  // whether legal evidence is rejected independently.
  const legalErrors=e=>readiness(e,{phase:'commercial'}).errors.filter(
    msg=>/Política|política|condiciones comerciales/.test(msg));
  assert.deepEqual(legalErrors(src),[]);
  const missing=structuredClone(src);missing.legal.policies.pop();
  assert.ok(legalErrors(missing).length>0,'One signed tenant is not both signed tenants');
  const draft=structuredClone(src);draft.legal.policies[0].signed_adoption_act=false;
  assert.ok(legalErrors(draft).length>0,'Unsigned draft must never pass');
  const mismatch=structuredClone(src);mismatch.legal.policies[1].pdf_sha256_matches_published_bytes=false;
  assert.ok(legalErrors(mismatch).length>0,'Catalog metadata is not proof of PDF bytes');
  const forged=structuredClone(src);forged.legal.policies[0].sha256='sha256-not-verified';
  assert.ok(legalErrors(forged).length>0);
  const wrongHost=structuredClone(src);wrongHost.legal.policies[0].url='https://app.inmojco.com/politicas/sistema-inmobiliario-jco.pdf';
  assert.ok(legalErrors(wrongHost).length>0,'Old app subdomain cannot be canonical policy URL');
  const stale=structuredClone(src);stale.legal.policies[0].pdf_verified_at='2030-02-15T11:00:00Z';
  assert.ok(legalErrors(stale).length>0,'Stale verification cannot authorize release');
});

test('G17: commercial release must never accept missing independent private Auth and Storage bytes evidence',()=>{
  const src=completeEvidence();
  src.deployment.wompi_mode='production';
  const messages=readiness(src,{phase:'commercial'}).errors.join(' ');
  assert.match(messages,/G16 cinco sesiones privadas reales/);
  assert.match(messages,/Archivos privados restaurados descargados/);
  assert.match(messages,/Comisión histórica #118/);
  assert.match(messages,/Copropietarios/);
  assert.match(messages,/Consignación y fotografías privadas/);
});

test('CLI with no evidence always exits nonzero and never publishes', () => {
  const run=spawnSync(process.execPath, [
    new URL('../scripts/release-readiness.mjs',import.meta.url).pathname,
    '/non-existent-inmojco-evidence-file.json',
  ],{encoding:'utf8'});
  assert.equal(run.status,1);
  assert.match(run.stderr,/BLOQUEADO/);
});
