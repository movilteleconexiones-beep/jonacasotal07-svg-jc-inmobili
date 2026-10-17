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
  ['security.agency_a_b_isolation', 'Aislamiento de dos inmobiliarias autenticadas'],
  ['security.client_and_staff_permissions', 'Usuarios CLIENT, asesor y administrador comprobados'],
  ['security.platform_admin_exclusive', 'SuperAdmin exclusivo y lectura global comprobados'],
  ['security.external_owner_tenant', 'Portales personales de propietarios e inquilinos comprobados'],
  ['deployment.rollback_reviewed', 'Procedimiento de recuperación revisado'],
  ['deployment.window_confirmed', 'Ventana de mantenimiento confirmada'],
];

const commercialChecks = [
  ['commercial.financial_flows_verified', 'Cobros, abonos, deducciones y liquidaciones comprobados'],
  ['commercial.smtp_invitation_recovery', 'Correo de invitación y recuperación probado'],
  ['commercial.wompi_sandbox_signed', 'Firma e idempotencia de Wompi Sandbox probadas'],
  ['commercial.licensing_is_superadmin_only', 'Licencias y cobros restringidos al SuperAdmin'],
];

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
  phase = 'pr185',
  expectedCommit = null,
  now = new Date(),
} = {}) {
  if (!['pr185', 'commercial'].includes(phase)) throw new Error('Fase no válida');
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
  if (e.deployment?.wompi_mode !== 'sandbox')
    errors.push('Wompi debe continuar en modo sandbox; no activar cobros reales.');
  for (const [key, description] of checks) {
    if (get(e, key) !== true) errors.push('Falta evidencia: ' + description + '.');
  }
  if (phase === 'commercial') {
    for (const [key, description] of commercialChecks) {
      if (get(e, key) !== true) errors.push('Falta evidencia comercial: ' + description + '.');
    }
  }
  return { ready: errors.length === 0, phase, errors };
}

function main() {
  const path = resolve(process.argv[2] || 'release-evidence.local.json');
  const phase = process.argv[3] || 'pr185';
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
