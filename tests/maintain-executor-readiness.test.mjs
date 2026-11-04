import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {assessMaintainExecutor} from '../scripts/ops/maintain-executor-readiness.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=join(root,'docs/ops/snapshots/maintain-executor-readiness-2026-11-02.json');
const snapshot=JSON.parse(readFileSync(file,'utf8'));

test('live Supabase postgres cannot run all-in-one MAINTAIN fix; four defaults still at risk',()=>{
  const report=assessMaintainExecutor(snapshot);
  assert.equal(snapshot.executor,'postgres');
  assert.equal(snapshot.executor_superuser,false);
  assert.equal(snapshot.member_of_supabase_admin,false);
  assert.equal(snapshot.can_set_supabase_admin,false);
  assert.deepEqual(report.unreachable_default_acl_owners,['supabase_admin']);
  assert.equal(report.all_in_one_executor_qualified,false);
  assert.equal(report.examined_public_tables,58);
  assert.equal(report.anon_maintain_tables,35);
  assert.equal(report.authenticated_maintain_tables,41);
  assert.equal(report.problematic_default_grants,4);
  assert.equal(report.production_change_authorized,false);
  assert.equal(report.migration_push_authorized,false);
});
test('per-owner readiness never bypasses staging or production authorization',()=>{
  const roleMember=assessMaintainExecutor({...snapshot,member_of_supabase_admin:true});
  assert.equal(roleMember.all_in_one_executor_qualified,true);
  assert.equal(roleMember.production_change_authorized,false);
  assert.equal(roleMember.staging_verified,false);
  const superuser=assessMaintainExecutor({...snapshot,executor_superuser:true});
  assert.equal(superuser.all_in_one_executor_qualified,true);
  assert.equal(superuser.production_change_authorized,false);
  const nonOwner=assessMaintainExecutor({...snapshot,other_owner_tables:1});
  assert.equal(nonOwner.all_in_one_executor_qualified,false);
});
test('malformed or inconsistent role metadata fails closed',()=>{
  assert.throws(()=>assessMaintainExecutor({...snapshot,executor_superuser:'false'}),/Invalid/);
  assert.throws(()=>assessMaintainExecutor({...snapshot,public_tables:1}),/Inconsistent/);
  assert.throws(()=>assessMaintainExecutor({...snapshot,member_of_supabase_admin:undefined}),/Invalid/);
  assert.throws(()=>assessMaintainExecutor({...snapshot,executor:undefined}),/Invalid/);
  const corrupt={...snapshot};
  delete corrupt.default_owner_roles;
  assert.throws(()=>assessMaintainExecutor(corrupt),/Missing/);
});
test('command is read-only and refuses apply, repair and revoke flags',()=>{
  const script=join(root,'scripts/ops/maintain-executor-readiness.mjs');
  const good=spawnSync(process.execPath,[script,'--snapshot',file],{cwd:root,encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/NO-GO/);
  assert.match(good.stdout,/Can run full existing candidate: false/);
  for(const flag of ['--apply','--repair','--revoke']) {
    const bad=spawnSync(process.execPath,[script,'--snapshot',file,flag],{cwd:root,encoding:'utf8'});
    assert.equal(bad.status,2);
    assert.match(bad.stderr,/Refusing mutation argument/);
  }
});
