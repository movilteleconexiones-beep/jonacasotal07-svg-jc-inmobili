#!/usr/bin/env node
// INMOJCO: fail-closed release checklist. Does not modify databases or deploy.
// Evidence is private/local, never put secrets, payment records or backups in git.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_PROJECT_REF = 'cuitgyqrjibgwuniapmk';

const SHA = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const checks = [
  ['ci.passed', 'CI combinada aprobada'],
  ['database.migrations_reviewed', 'Migraciones y prerrequisitos revisados'],
  ['database.backup_restored_isolated', 'Respaldo restaurado y verificado en entorno aislado'],
  ['database.storage_objects_restored', 'Fotos, contratos y soportes de Storage restaurados y comprobados'],
  ['security.agency_a_b_isolation', 'Aislamiento de dos inmobiliarias autenticadas'],
  ['security.client_and_staff_permissions', 'Usuarios CLIENT, asesor y administrador comprobados'],
  ['security.platform_admin_exclusive', 'SuperAdmin exclusivo y lectura global comprobados'],
  ['security.external_owner_tenant', 'Portales personales de propietarios e inquilinos comprobados'],
  ['deployment.rollback_reviewed', 'Procedimiento de recuperación revisado'],
  ['deployment.window_confirmed', 'Ventana de mantenimiento confirmada'],
];

const commercialChecks = [
  ['commercial.production_signed_payment_verified', 'Pago real Wompi firmado y conciliado con la transacción externa'],
  ['commercial.production_fulfillment_applied', 'Orden real aplicada una única vez (APPLIED)'],
  ['commercial.production_license_activated', 'Nueva suscripción y licencia activas para el cliente que pagó'],
  ['commercial.payment_idempotency_verified', 'Webhook repetido sin doble licencia ni doble período'],
  ['commercial.renewal_and_suspension_verified', 'Renovación, vencimiento y suspensión probados'],
  ['commercial.financial_flows_verified', 'Cobros, abonos, deducciones y liquidaciones comprobados'],
  ['commercial.smtp_invitation_recovery', 'Correo de invitación y recuperación probado'],
  ['commercial.wompi_sandbox_signed', 'Firma e idempotencia de Wompi Sandbox probadas'],
  ['commercial.wompi_real_approved', 'Autorización expresa del SuperAdmin para habilitar Wompi real'],
  ['commercial.licensing_is_superadmin_only', 'Licencias y cobros restringidos al SuperAdmin'],
  // These are independent release prerequisites; CI or simulated JWT/SQL
  // cannot replace real browser, restored binaries or signed legal evidence.
  ['security.real_auth_five_role_browser', 'G16 cinco sesiones privadas reales con JWT y rol independiente'],
  ['security.financial_rpc_authorization_reviewed', 'RPC financieras críticas verificadas por identidad y organización'],
  ['database.storage_binary_sha256_verified', 'Archivos privados restaurados descargados y comparados por SHA-256'],
  ['commercial.private_financial_browser_e2e', 'Contratos, cobros, liquidaciones, giros ficticios y reversos en interfaz privada'],
  ['commercial.shared_owner_financial_browser_e2e', 'Copropietarios y distribución sin doble cargo en sesiones reales'],
  ['commercial.commission_118_documented', 'Comisión histórica #118 conciliada con contrato y comprobante originales'],
  ['commercial.public_crm_consent_e2e', 'CRM público con política vigente y recibo de consentimiento privado'],
  ['commercial.consignment_private_photo_e2e', 'Consignación y fotografías privadas E2E después de G07'],
  ['deployment.production_smoke_verified', 'Dominio oficial, rutas canónicas, acceso privado y móvil verificados tras despliegue'],
  ['deployment.rollback_rehearsed', 'Simulacro reproducible de reversión y recuperación sin alterar datos reales'],
];

// G07: the personal SuperAdmin tenant and the separately owned test tenant
// have distinct data controllers. Never equate SaaS vendor approval with
// the future external tenant's adoption of an agency privacy policy.
// The external tenant may remain legally non-collecting, with fresh,
// independent negative evidence, without blocking SaaS commercial readiness.
const PERSONAL_TENANT = 'jco-inmodigital-global';
const EXTERNAL_TENANT = 'sistema-inmobiliario-jco';
const REQUIRED_POLICY_URLS = new Map([
  [PERSONAL_TENANT, 'https://www.inmojco.com/politicas/jco-inmodigital-global.pdf'],
  [EXTERNAL_TENANT, 'https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf'],
]);

function checkClosedExternalAgencyEvidence(legal, now, errors, commitSha) {
  const closed = legal?.noncollecting_external_agency;
  if (!closed || closed.slug !== EXTERNAL_TENANT ||
      closed.project_ref !== PRODUCTION_PROJECT_REF ||
      closed.commit_sha !== commitSha ||
      !recentTimestamp(closed.verified_at, now, 24) ||
      closed.property_intake_disabled_db !== true ||
      closed.crm_anon_rpc_denied !== true ||
      closed.consignment_anon_rpc_denied !== true ||
      closed.public_forms_closed_browser !== true ||
      closed.legacy_policy_not_advertised !== true ||
      closed.actual_controller_not_onboarded !== true) {
    errors.push('G07: la inmobiliaria externa sin aprobación propia debe permanecer cerrada a datos personales; falta prueba negativa actual de DB, RPC, navegador y enlaces legales.');
  }
}

function checkSignedPolicyEvidence(legal, now, errors, commitSha) {
  const policies = legal?.policies;
  if (!Array.isArray(policies) || policies.length < 1 || policies.length > REQUIRED_POLICY_URLS.size) {
    errors.push('G07: faltan políticas jurídicas específicas; como mínimo la de la inmobiliaria personal del SuperAdmin.');
    return;
  }
  const seen = new Set();
  for (const policy of policies) {
    const slug = policy?.slug;
    const target = REQUIRED_POLICY_URLS.get(slug);
    if (!target || seen.has(slug)) {
      errors.push('G07: política duplicada o de inmobiliaria no reconocida.');
      continue;
    }
    seen.add(slug);
    if (policy.url !== target ||
        !SHA256.test(policy.sha256 ?? '') ||
        typeof policy.version !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(policy.version) ||
        policy.signed_adoption_act !== true ||
        policy.pdf_sha256_matches_published_bytes !== true ||
        !recentTimestamp(policy.pdf_verified_at, now, 168) ||
        typeof policy.approved_at !== 'string' ||
        !Number.isFinite(Date.parse(policy.approved_at)) ||
        Date.parse(policy.approved_at) > now.getTime() + 600000) {
      errors.push('G07: política de ' + slug + ': faltan adopción auténtica, versión, PDF HTTPS/hash o verificación reciente.');
    }
    if (slug === EXTERNAL_TENANT &&
        (policy.controller_verified_for_org !== true ||
         policy.brand_name_verified !== true ||
         policy.current_controller_adoption_verified !== true ||
         (policy.version === '1.2' && policy.url === target))) {
      errors.push('G07: política de inmobiliaria externa sin adopción por su nuevo responsable; el PDF histórico v1.2 no acredita a otro titular.');
    }
  }
  if (!seen.has(PERSONAL_TENANT))
    errors.push('G07: falta política vigente aprobada de la inmobiliaria personal del SuperAdmin (jco-inmodigital-global).');
  if (!seen.has(EXTERNAL_TENANT))
    checkClosedExternalAgencyEvidence(legal, now, errors, commitSha);
}

/**
 * G24 is independent from the two estate agencies' privacy policies. The
 * SOFTWARE VENDOR must be identified at the commercial point of sale.
 * Evidence flags are reviewer attestations, never proof of a registry lookup.
 */
function checkSaasSellerEvidence(legal, now, errors) {
  const seller=legal?.saas_seller;
  if (!seller || typeof seller!=='object') {
    errors.push('G24: falta la identidad jurídica verificable del vendedor del SaaS.');
    return;
  }
  // G24 commercial seller: owner explicitly confirmed Colombian natural person.
  // This does not certify RUT, IVA, or DIAN obligations.
  if (seller.taxpayer_type !== 'NATURAL_PERSON') {
    errors.push('G24: vendedor SaaS debe identificarse como persona natural según la configuración comercial aprobada.');
  }
  const meaningful=(value,min=4,max=200)=>
    typeof value==='string' &&
    value.trim().length>=min && value.trim().length<=max &&
    !/\[[^\]]*\]|PENDIENTE|POR DEFINIR|BORRADOR|PLACEHOLDER/i.test(value);
  const id=String(seller.identification_number??'').trim();
  const email=String(seller.pqr_email??'').trim();
  if (!meaningful(seller.legal_name) ||
      !['NIT','CC','CE'].includes(seller.identification_type) ||
      !/^[0-9][0-9.-]{4,19}$/.test(id) ||
      !/[1-9]/.test(id) ||
      !meaningful(seller.business_address,8,250) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ||
      !recentTimestamp(seller.identity_verified_at,now,168) ||
      seller.identity_documents_verified!==true) {
    errors.push('G24: identificación, domicilio, contacto PQR y soporte jurídico auténtico del vendedor no verificados.');
  }
  if (seller.homepage_identity_verified!==true ||
      seller.checkout_identity_verified!==true ||
      seller.consumer_rights_link_verified!==true ||
      seller.buyer_information_verified!==true) {
    errors.push('G24: falta comprobar identificación del vendedor y derechos del consumidor en portada y checkout.');
  }
  // IVA, invoice duties and CIIU classification are three separate legal
  // assessments. An RUT code is NOT proof of exempted SaaS invoices.
  if (seller.vat_status_reviewed!==true ||
      !['NON_RESPONSIBLE','RESPONSIBLE'].includes(seller.vat_regime) ||
      seller.checkout_tax_treatment_verified!==true) {
    errors.push('G24: tratamiento IVA y presentación tributaria del precio SaaS no verificados.');
  }
  if (seller.saas_activity_classification_reviewed!==true) {
    errors.push('G24: actividad CIIU de venta y operación SaaS pendiente de revisión.');
  }
  if (seller.dian_obligation_reviewed!==true ||
      !['ELECTRONIC_INVOICE','DOCUMENTED_EXCEPTION'].includes(seller.invoice_mode) ||
      (seller.invoice_mode==='ELECTRONIC_INVOICE' && seller.electronic_invoicing_tested!==true) ||
      (seller.invoice_mode==='DOCUMENTED_EXCEPTION' && seller.exception_documented!==true)) {
    errors.push('G24: falta evaluar y acreditar el mecanismo de facturación DIAN aplicable.');
  }
}

/**
 * G25: never start billing LIVE while the checkout catalogue differs from
 * the amounts individually reviewed and approved by the software seller.
 * Private evidence stores only cryptographic hashes; no payment secrets.
 * Same SHA alone is not proof: reviewers must separately verify the exact
 * canonical rows, the buyer-facing amounts and the approval's provenance.
 */
// Canonical active COP monthly/annual checkout rows approved by the owner
// on 2026-11-22 (BASIC 149900; PRO 349900; capacities 5/200 and 25/2000).
// Updating either amount requires a new explicit approval and SHA review.
export const APPROVED_COMMERCIAL_CATALOG_SHA256 = '51ae873f180c1a5cb05de659106771edfae0b994f85fde271d4c23441d8bee46';

function checkCommercialPricingEvidence(e, now, errors) {
  const pricing = e.commercial?.pricing_catalog;
  if (!pricing ||
      pricing.project_ref !== PRODUCTION_PROJECT_REF ||
      pricing.commit_sha !== e.commit_sha ||
      !recentTimestamp(pricing.verified_at, now, 24) ||
      !SHA256.test(pricing.approved_catalog_sha256 ?? '') ||
      !SHA256.test(pricing.live_catalog_sha256 ?? '') ||
      String(pricing.approved_catalog_sha256).toLowerCase() !== APPROVED_COMMERCIAL_CATALOG_SHA256 ||
      String(pricing.approved_catalog_sha256).toLowerCase() !==
        String(pricing.live_catalog_sha256).toLowerCase() ||
      pricing.superadmin_catalog_approval_verified !== true ||
      pricing.checkout_prices_checked_against_live !== true) {
    errors.push('G25: catálogo y precios LIVE sin conciliación reciente, aprobación del SuperAdmin y comparación SHA-256 con importes de checkout.');
  }
}

function get(obj, path) {
  return path.split('.').reduce((current, key) => current && current[key], obj);
}

function recentTimestamp(value, now, maxHours) {
  if (typeof value !== 'string' || !/Z$|[+-]\d\d:\d\d$/.test(value)) return false;
  const time = Date.parse(value);
  const age = now.getTime() - time;
  return Number.isFinite(time) && age >= -600000 && age <= maxHours * 3600000;
}

/**
 * This is a checklist, NOT proof that a backup exists or a deployed system
 * works. A reviewer must independently verify the linked evidence. It is
 * deliberately blocked by default and must never auto-publish anything.
 */
export function evaluateReleaseReadiness(evidence, {
  phase = 'integration',
  expectedCommit = null,
  now = new Date(),
} = {}) {
  if (!['integration', 'commercial'].includes(phase)) throw new Error('Fase de liberación no válida');
  const errors = [];
  const e = evidence && typeof evidence === 'object' ? evidence : {};
  if (e.project_ref !== PRODUCTION_PROJECT_REF)
    errors.push('Proyecto Supabase no coincide con la producción de INMOJCO.');
  if (!SHA.test(e.commit_sha ?? ''))
    errors.push('Falta el commit GitHub SHA completo (40 caracteres).');
  if (expectedCommit && e.commit_sha !== expectedCommit)
    errors.push('La evidencia corresponde a un commit distinto del que se pretende publicar.');
  if (e.ci?.commit_sha !== e.commit_sha)
    errors.push('La CI registrada no corresponde exactamente al commit candidato.');
  if (!SHA256.test(e.database?.backup_sha256 ?? ''))
    errors.push('Falta la huella SHA-256 del archivo de respaldo privado.');
  if (!recentTimestamp(e.database?.backup_created_at, now, 24))
    errors.push('El respaldo debe ser reciente (últimas 24 horas) y tener fecha con zona horaria.');
  if (!recentTimestamp(e.database?.restore_verified_at, now, 168))
    errors.push('La restauración de prueba debe estar verificada dentro de los últimos 7 días.');
  // Timestamp order is insufficient: the restored object must be precisely the
  // backup whose hash was independently computed for this release.
  if (!SHA256.test(e.database?.restored_backup_sha256 ?? '') ||
      String(e.database.restored_backup_sha256).toLowerCase() !== String(e.database.backup_sha256 ?? '').toLowerCase())
    errors.push('La restauración no corresponde al SHA-256 del respaldo de esta liberación.');
  // Do not accept a restore performed against production as disaster-recovery
  // evidence. Explicitly record whether the destination is local or staging.
  const restoreTarget = e.database?.restore_target;
  if (typeof restoreTarget !== 'string' ||
      !/^(local|staging):[a-z0-9][a-z0-9_-]{2,63}$/.test(restoreTarget) ||
      restoreTarget.endsWith(PRODUCTION_PROJECT_REF))
    errors.push('La restauración requiere un destino local o staging identificable, distinto a producción.');
  if (Date.parse(e.database?.restore_verified_at) < Date.parse(e.database?.backup_created_at))
    errors.push('La restauración debe ser posterior al respaldo reciente.');
  if (phase === 'integration' && e.deployment?.wompi_mode !== 'sandbox')
    errors.push('Wompi debe continuar en modo sandbox durante la integración fase de integración.');
  if (phase === 'commercial' && e.deployment?.wompi_mode !== 'production')
    errors.push('La fase comercial exige Wompi en producción con prueba real verificada, sin aceptar Sandbox como venta.');
  for (const [key, description] of checks) {
    if (get(e, key) !== true) errors.push('Falta evidencia: ' + description + '.');
  }
  if (phase === 'commercial') {
    if (e.commercial?.approved_environment !== 'production')
      errors.push('Las órdenes Sandbox nunca pueden acreditar la primera venta comercial.');
    if (e.commercial?.approved_order_status !== 'APPROVED' ||
        e.commercial?.approved_fulfillment_status !== 'APPLIED')
      errors.push('Falta orden de producción APPROVED/APPLIED verificable.');
    checkSignedPolicyEvidence(e.legal, now, errors, e.commit_sha);
    checkSaasSellerEvidence(e.legal,now,errors);
    checkCommercialPricingEvidence(e, now, errors);
    if(e.legal?.consumer_terms_approved!==true ||
       e.legal?.buyer_acceptance_verified!==true){
      errors.push('Faltan condiciones comerciales aprobadas y aceptación válida del comprador.');
    }
    for (const [key, description] of commercialChecks) {
      if (get(e, key) !== true) errors.push('Falta evidencia comercial: ' + description + '.');
    }
  }
  return { ready: errors.length === 0, phase, errors };
}

function main() {
  const path = resolve(process.argv[2] || 'release-evidence.local.json');
  const phase = process.argv[3] || 'integration';
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error('BLOQUEADO: no existe evidencia local válida de respaldo, restauración y seguridad.');
    process.exitCode = 1;
    return;
  }
  let expectedCommit;
  try {
    expectedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8' }).trim();
  } catch {
    console.error('BLOQUEADO: no se puede verificar el commit GitHub local.');
    process.exitCode = 1;
    return;
  }
  let report;
  try {
    report = evaluateReleaseReadiness(evidence, {phase,expectedCommit});
  } catch (error) {
    console.error('BLOQUEADO:', error.message);
    process.exitCode = 1;
    return;
  }
  if (!report.ready) {
    console.error('NO APTO PARA PUBLICAR:\n' + report.errors.map(x => '- ' + x).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('LISTA DE CONTROL COMPLETA PARA REVISIÓN HUMANA.');
  console.log('Este resultado no despliega, no fusiona PR y no sustituye comprobar las pruebas y el backup.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
