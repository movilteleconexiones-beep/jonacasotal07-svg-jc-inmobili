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
      backup_created_at: '2030-03-10T08:00:00.000Z',
      backup_restored_isolated: true,
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
  assert.deepEqual(readiness(completeEvidence()), { ready:true,phase:'pr185',errors:[] });
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
  assert.match(readiness(reversed).errors.join(' '), /mismo respaldo reciente/);
  const future=completeEvidence();future.database.backup_created_at='2030-03-11T10:00:00Z';
  assert.equal(readiness(future).ready,false);
});

test('sandbox is mandatory for PR phase and commercial launch has stricter gates', () => {
  const commercial=completeEvidence();
  assert.equal(readiness(commercial,{phase:'commercial'}).ready,false);
  assert.match(readiness(commercial,{phase:'commercial'}).errors.join(' '), /Wompi real/);
  commercial.deployment.wompi_mode='production';
  commercial.commercial={
    financial_flows_verified:true,
    smtp_invitation_recovery:true,
    wompi_sandbox_signed:true,
    wompi_real_approved:true,
    licensing_is_superadmin_only:true,
  };
  assert.equal(readiness(commercial,{phase:'commercial'}).ready,true);
  assert.equal(readiness(commercial,{phase:'pr185'}).ready,false);
  commercial.commercial.wompi_real_approved=false;
  assert.equal(readiness(commercial,{phase:'commercial'}).ready,false);
});

test('CLI with no evidence always exits nonzero and never publishes', () => {
  const run=spawnSync(process.execPath, [
    new URL('../scripts/release-readiness.mjs',import.meta.url).pathname,
    '/non-existent-inmojco-evidence-file.json',
  ],{encoding:'utf8'});
  assert.equal(run.status,1);
  assert.match(run.stderr,/BLOQUEADO/);
});
