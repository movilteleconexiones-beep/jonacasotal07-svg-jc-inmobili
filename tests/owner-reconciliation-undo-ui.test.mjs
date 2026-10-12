import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const ui=readFileSync(new URL('../src/modules/finance/OwnerDeductionLedger.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261012203000_owner_reconciliation_audit_and_safe_undo.sql',import.meta.url),'utf8');

test('draft reconciliation can be updated and administrator can request a reasoned safe undo',()=>{
  assert.match(ui,/Actualizar conciliación/);
  assert.match(ui,/Deshacer última conciliación/);
  assert.match(ui,/reconcile_owner_draft_statement_audited/);
  assert.match(ui,/revert_owner_draft_reconciliation/);
  assert.match(ui,/canRevert=canReconcile&&\(activeMembership\?\.roles\.some\(role=>role\.key==='ADMIN'\)/);
  assert.match(ui,/reason\.length<8\|\|reason\.length>500/);
  assert.match(ui,/statement\.status!=='DRAFT'/);
  assert.match(ui,/window\.confirm\('¿Deshacer la última conciliación auditada/);
  assert.match(ui,/No se pudo deshacer la conciliación/);
  assert.match(ui,/Las conciliaciones antiguas sin historial no pueden deshacerse automáticamente/);
});

test('audit wrap invokes original server accounting and records both snapshots',()=>{
  assert.match(migration,/result_net:=public\.reconcile_owner_draft_statement\(target_org,target_statement\)/);
  assert.match(migration,/owner_statement\.reconciled/);
  assert.match(migration,/'before',pg_catalog\.jsonb_build_object/);
  assert.match(migration,/'after',pg_catalog\.jsonb_build_object/);
  assert.match(migration,/'source_hash',source_hash/);
  assert.match(migration,/FOR UPDATE/);
  assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM public\.rent_payments|DELETE FROM public\.owner_statement_deductions/);
});

test('reverse requires admin role, draft state, latest audit, identical source signature and prior amounts',()=>{
  assert.match(migration,/r\.key='ADMIN' AND r\.active/);
  assert.match(migration,/statement\.status<>'DRAFT'/);
  assert.match(migration,/latest\.action<>'owner_statement\.reconciled'/);
  assert.match(migration,/source_hash' IS DISTINCT FROM source_hash/);
  assert.match(migration,/current<>actual/);
  assert.match(migration,/owner_statement\.reverted/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.revert_owner_draft_reconciliation\(uuid,uuid,text\)/);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.revert_owner_draft_reconciliation/);
  assert.match(migration,/length\(btrim\(reason\)\)<8/);
});
