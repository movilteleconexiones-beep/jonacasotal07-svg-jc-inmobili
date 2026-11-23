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

const verifiedSeller=()=>({
  // Synthetic unit-test data only. NEVER use this as merchant identity in prod.
  taxpayer_type:'NATURAL_PERSON',
  legal_name:'Titular ficticio de pruebas',
  identification_type:'NIT',
  identification_number:'900555001-1',
  business_address:'Dirección sintética 123, Colombia',
  pqr_email:'soporte@example.test',
  identity_verified_at:'2030-03-10T10:00:00Z',
  identity_documents_verified:true,
  homepage_identity_verified:true,
  checkout_identity_verified:true,
  consumer_rights_link_verified:true,
  buyer_information_verified:true,
  vat_status_reviewed:true,
  vat_regime:'NON_RESPONSIBLE',
  checkout_tax_treatment_verified:true,
  saas_activity_classification_reviewed:true,
  dian_obligation_reviewed:true,
  invoice_mode:'ELECTRONIC_INVOICE',
  electronic_invoicing_tested:true,
});

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
    saas_seller:verifiedSeller(),
    consumer_terms_approved:true,
    buyer_acceptance_verified:true,
    policies:[
      { slug:'sistema-inmobiliario-jco',
        url:'https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf',
        sha256:'d'.repeat(64), version:'1.0',
        signed_adoption_act:true, pdf_sha256_matches_published_bytes:true,
        controller_verified_for_org:true, brand_name_verified:true,
        current_controller_adoption_verified:true,
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
    pricing_catalog:{
      project_ref:PRODUCTION_PROJECT_REF,
      commit_sha:sha,
      verified_at:'2030-03-10T11:00:00Z',
      approved_catalog_sha256:'a'.repeat(64),
      live_catalog_sha256:'a'.repeat(64),
      superadmin_catalog_approval_verified:true,
      checkout_prices_checked_against_live:true,
    },
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
  assert.match(result.errors.join(' '),/políticas jurídicas específicas/);
});

test('G17: verify identity, document hash, signed act and canonical URL for each policy',()=>{
  const src=completeEvidence();
  src.deployment.wompi_mode='production';
  const policy=(slug)=>({
    slug,url:'https://www.inmojco.com/politicas/'+slug+'.pdf',sha256:'f'.repeat(64),
    version:'1.0',signed_adoption_act:true,pdf_sha256_matches_published_bytes:true,
    approved_at:'2030-03-09T12:00:00Z',pdf_verified_at:'2030-03-10T11:00:00Z',
    controller_verified_for_org:true, brand_name_verified:true, current_controller_adoption_verified:true,
  });
  src.legal={consumer_terms_approved:true,buyer_acceptance_verified:true,policies:[
    policy('sistema-inmobiliario-jco'),policy('jco-inmodigital-global')]};
  // The other commercial gates remain missing in this unit; focus only on
  // whether legal evidence is rejected independently.
  const legalErrors=e=>readiness(e,{phase:'commercial'}).errors.filter(
    msg=>/^G07:|^Faltan condiciones comerciales/.test(msg));
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


test('G24: commercial release fails without the seller identity, even with both signed agency policies',()=>{
  const evidence=completeEvidence();
  evidence.deployment.wompi_mode='production';
  evidence.legal={consumer_terms_approved:true,buyer_acceptance_verified:true,policies:[]};
  const onlySeller=e=>readiness(e,{phase:'commercial'}).errors.filter(msg=>msg.startsWith('G24:'));
  assert.ok(onlySeller(evidence).length>0,'Absent seller must be blocking');
  evidence.legal.saas_seller=verifiedSeller();
  assert.deepEqual(onlySeller(evidence),[],'Independently verified seller clears only G24, not other launch gates');
  const juridical=structuredClone(evidence);
  juridical.legal.saas_seller.taxpayer_type='LEGAL_ENTITY';
  assert.match(onlySeller(juridical).join(' '),/persona natural/);
  const missingTaxType=structuredClone(evidence);
  delete missingTaxType.legal.saas_seller.taxpayer_type;
  assert.ok(onlySeller(missingTaxType).length>0);
  const placeholder=structuredClone(evidence);
  placeholder.legal.saas_seller.legal_name='[NOMBRE PENDIENTE]';
  assert.ok(onlySeller(placeholder).length>0);
  const noCheckout=structuredClone(evidence);
  noCheckout.legal.saas_seller.checkout_identity_verified=false;
  assert.match(onlySeller(noCheckout).join(' '),/checkout/);
  const noVat=structuredClone(evidence);
  noVat.legal.saas_seller.vat_status_reviewed=false;
  assert.match(onlySeller(noVat).join(' '),/IVA/);
  const unknownVat=structuredClone(evidence);
  unknownVat.legal.saas_seller.vat_regime='ASSUMED_FREE';
  assert.match(onlySeller(unknownVat).join(' '),/IVA/);
  const untestedTaxTotal=structuredClone(evidence);
  untestedTaxTotal.legal.saas_seller.checkout_tax_treatment_verified=false;
  assert.match(onlySeller(untestedTaxTotal).join(' '),/precio SaaS/);
  const missingActivity=structuredClone(evidence);
  missingActivity.legal.saas_seller.saas_activity_classification_reviewed=false;
  assert.match(onlySeller(missingActivity).join(' '),/CIIU/);
  const noDian=structuredClone(evidence);
  noDian.legal.saas_seller.electronic_invoicing_tested=false;
  assert.match(onlySeller(noDian).join(' '),/DIAN/);
  const exception=structuredClone(evidence);
  exception.legal.saas_seller.invoice_mode='DOCUMENTED_EXCEPTION';
  exception.legal.saas_seller.exception_documented=true;
  delete exception.legal.saas_seller.electronic_invoicing_tested;
  assert.deepEqual(onlySeller(exception),[]);
  exception.legal.saas_seller.exception_documented=false;
  assert.ok(onlySeller(exception).length>0);
  const stale=structuredClone(evidence);
  stale.legal.saas_seller.identity_verified_at='2030-02-09T10:00:00Z';
  assert.ok(onlySeller(stale).length>0);
  const unsafe=structuredClone(evidence);
  unsafe.legal.saas_seller.identification_number='00000000';
  assert.ok(onlySeller(unsafe).length>0);
  assert.equal(readiness(evidence,{phase:'commercial'}).ready,false,'G24 alone is not a release permit');
});


test('G07: personal SuperAdmin policy is mandatory; external agency may stay fully closed',()=>{
  const e=completeEvidence();
  e.deployment.wompi_mode='production';
  const personal={
    slug:'jco-inmodigital-global',
    url:'https://www.inmojco.com/politicas/jco-inmodigital-global.pdf',
    sha256:'a'.repeat(64),version:'1.0',
    signed_adoption_act:true,pdf_sha256_matches_published_bytes:true,
    pdf_verified_at:'2030-03-10T11:00:00Z', approved_at:'2030-03-10T10:00:00Z',
  };
  const closed={
    slug:'sistema-inmobiliario-jco',
    project_ref:PRODUCTION_PROJECT_REF,
    commit_sha:sha,
    verified_at:'2030-03-10T11:00:00Z',
    property_intake_disabled_db:true,
    crm_anon_rpc_denied:true,
    consignment_anon_rpc_denied:true,
    public_forms_closed_browser:true,
    legacy_policy_not_advertised:true,
    actual_controller_not_onboarded:true,
  };
  e.legal={consumer_terms_approved:true,buyer_acceptance_verified:true,
    saas_seller:verifiedSeller(),policies:[personal],
    noncollecting_external_agency:closed};
  const legalErrors=(input)=>readiness(input,{phase:'commercial'}).errors.filter(x=>x.startsWith('G07:'));
  assert.deepEqual(legalErrors(e),[],'Verified closed external tenant must not block other legal owner');
  const absent=structuredClone(e);absent.legal.policies=[];
  assert.ok(legalErrors(absent).some(x=>/SuperAdmin|políticas jurídicas/.test(x)),'Personal agency cannot be skipped');
  for(const key of ['property_intake_disabled_db','crm_anon_rpc_denied',
    'consignment_anon_rpc_denied','public_forms_closed_browser',
    'legacy_policy_not_advertised','actual_controller_not_onboarded']){
    const broken=structuredClone(e);broken.legal.noncollecting_external_agency[key]=false;
    assert.ok(legalErrors(broken).length>0,'Missing negative evidence must fail: '+key);
  }
  for(const [key,value] of [['commit_sha','c'.repeat(40)],
    ['project_ref','another-project'],['verified_at','2030-02-01T00:00:00Z'],
    ['slug','jco-inmodigital-global']]){
    const broken=structuredClone(e);broken.legal.noncollecting_external_agency[key]=value;
    assert.ok(legalErrors(broken).length>0,'Incorrect source/scope must fail: '+key);
  }
  const legacy=structuredClone(e);
  delete legacy.legal.noncollecting_external_agency;
  legacy.legal.policies.push({
    slug:'sistema-inmobiliario-jco',
    url:'https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf',
    sha256:'b'.repeat(64),version:'1.2',
    signed_adoption_act:true,pdf_sha256_matches_published_bytes:true,
    pdf_verified_at:'2030-03-10T11:00:00Z',approved_at:'2030-03-09T12:00:00Z',
    controller_verified_for_org:true,brand_name_verified:true,
    current_controller_adoption_verified:true,
  });
  assert.ok(legalErrors(legacy).some(x=>/PDF histórico/.test(x)),
    'Old policy cannot authorize the future outside data controller');
  legacy.legal.policies[1].version='1.3';
  assert.deepEqual(legalErrors(legacy),[],'Only separately adopted new version can be presented');
});

test('G25: commercial launch blocks unapproved or mismatched live prices',()=>{
  const e=completeEvidence();
  e.deployment.wompi_mode='production';
  const onlyPricing=input=>readiness(input,{phase:'commercial'}).errors.filter(s=>s.startsWith('G25:'));
  assert.ok(onlyPricing(e).length>0,'No pricing evidence must block LIVE launch');
  e.commercial={pricing_catalog:{
    project_ref:PRODUCTION_PROJECT_REF,commit_sha:sha,
    verified_at:'2030-03-10T11:00:00Z',
    approved_catalog_sha256:'a'.repeat(64),live_catalog_sha256:'a'.repeat(64),
    superadmin_catalog_approval_verified:true,checkout_prices_checked_against_live:true,
  }};
  assert.deepEqual(onlyPricing(e),[],'Only verified exact match clears the pricing gate');
  const wrong=structuredClone(e);
  wrong.commercial.pricing_catalog.live_catalog_sha256='b'.repeat(64);
  assert.ok(onlyPricing(wrong).length>0,'Mismatch in even one price blocks launch');
  const unapproved=structuredClone(e);
  unapproved.commercial.pricing_catalog.superadmin_catalog_approval_verified=false;
  assert.ok(onlyPricing(unapproved).length>0);
  const stale=structuredClone(e);
  stale.commercial.pricing_catalog.verified_at='2030-03-07T11:00:00Z';
  assert.ok(onlyPricing(stale).length>0);
  const wrongCommit=structuredClone(e);
  wrongCommit.commercial.pricing_catalog.commit_sha='c'.repeat(40);
  assert.ok(onlyPricing(wrongCommit).length>0);
  const wrongProject=structuredClone(e);
  wrongProject.commercial.pricing_catalog.project_ref='another-supabase-project';
  assert.ok(onlyPricing(wrongProject).length>0);
  const unchecked=structuredClone(e);
  unchecked.commercial.pricing_catalog.checkout_prices_checked_against_live=false;
  assert.ok(onlyPricing(unchecked).length>0);
  assert.equal(readiness(e,{phase:'commercial'}).ready,false,
    'Pricing equality does not bypass G07/G12/G16/backup/DIAN gates');
});
