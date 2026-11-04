import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Offline fail-closed audit of metadata-only SQL. No connection to Supabase,
// secrets, finance records, tenant records or deployment actions.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(join(root,'security/checks/finance_six_function_live_contract_20261104.sql'),'utf8');
const snapshot=JSON.parse(readFileSync(join(root,
  'docs/ops/snapshots/finance-function-catalog-2026-11-02.json'),'utf8'));

const signatures=new Map([
  ['create_owner_draft_statement','(uuid,uuid,date,numeric,numeric)'],
  ['create_tenant_rent_period','(uuid,uuid,date)'],
  ['guard_owner_statement_deduction_change','()'],
  ['normalize_owner_deduction_audit_fields','()'],
  ['reconcile_owner_draft_statement','(uuid,uuid)'],
  ['record_tenant_rent_receipt','(uuid,uuid,numeric,text,text,uuid)'],
]);

function assertMetadataOnlyContract(raw) {
  const sql=raw.split(/\r?\n/).filter(line=>!line.trimStart().startsWith('--'))
    .join('\n').trim();
  assert.match(sql,/^WITH\s+expected\s*\(/);
  assert.ok(sql.endsWith(';'));
  assert.equal((sql.match(/;(?=\s|$)/g)??[]).length,1,'Exactly one read-only SELECT');
  assert.doesNotMatch(sql,/\b(?:FROM|JOIN)\s+(?:public|private|auth|storage|supabase_migrations|jco_private)\./i);
  assert.doesNotMatch(sql,/^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DO|CALL|COPY|SET|MERGE|EXECUTE|VACUUM|ANALYZE)\b/im);
  assert.doesNotMatch(sql,/\b(?:pg_read_file|pg_ls_dir|dblink|postgres_fdw)\s*\(/i);
  assert.equal(snapshot.functions.length,6);
  assert.equal(signatures.size,6);
  for(const f of snapshot.functions){
    const signature=signatures.get(f.proname);
    assert.ok(signature,'Unexpected public financial function '+f.proname);
    const q=s=>"'"+s+"'";
    const row=[
      q(f.proname),q(f.proname+signature),q(f.args),
      q(f.body_md5),q(f.definition_md5),
      String(f.security_definer),q(f.function_settings),
      String(f.anon_can_execute),String(f.authenticated_can_execute),
      String(f.service_role_can_execute),
    ].join(',');
    assert.ok(sql.includes('('+row+')'),'Missing or modified pinned metadata: '+f.proname);
  }
  for(const clause of [
    'pg_get_function_identity_arguments(p.oid)',
    'md5(p.prosrc)',
    'md5(pg_get_functiondef(p.oid))',
    "pg_get_userbyid(p.proowner)",
    "has_function_privilege('anon',p.oid,'EXECUTE')",
    "has_function_privilege('authenticated',p.oid,'EXECUTE')",
    "has_function_privilege('service_role',p.oid,'EXECUTE')",
    "p.oid=to_regprocedure('public.'||e.signature)",
    "extra.pronamespace='public'::regnamespace",
    'extra.proname=e.name',
    'same_name_overload_count=1',
    "actual_owner='postgres'",
    'actual_args=identity_args',
    'actual_body_md5=body_md5 AND actual_definition_md5=definition_md5',
    'actual_definer=security_definer AND actual_settings=settings',
    'actual_anon_execute IS NOT DISTINCT FROM anon_execute',
    'actual_auth_execute IS NOT DISTINCT FROM auth_execute',
    'actual_service_execute IS NOT DISTINCT FROM service_execute',
    "THEN 'BASELINE_MATCH' ELSE 'DRIFT'",
  ]) assert.ok(sql.includes(clause),'Missing fail-closed guard: '+clause);
  return sql;
}

test('read-only live finance RPC audit pins six real function bodies and permissions',()=>{
  assertMetadataOnlyContract(source);
});

test('body, SECURITY DEFINER, ACL and name-overload weakening must fail CI',()=>{
  const cases=[
    source.replace(snapshot.functions[0].body_md5,'00000000000000000000000000000000'),
    source.replace("actual_owner='postgres'","actual_owner IS NOT NULL"),
    source.replace('same_name_overload_count=1','same_name_overload_count>=1'),
    source.replace('actual_definer=security_definer','actual_definer IS NOT NULL'),
    source.replace('actual_auth_execute IS NOT DISTINCT FROM auth_execute','true'),
    source.replace("THEN 'BASELINE_MATCH' ELSE 'DRIFT'","THEN 'BASELINE_MATCH' ELSE 'BASELINE_MATCH'"),
    source.replace('md5(pg_get_functiondef(p.oid))','md5(p.prosrc)'),
    source+'\nSELECT * FROM public.rent_receipts;',
    source+'\nUPDATE public.subscriptions SET status=\'ACTIVE\';',
  ];
  for(const altered of cases){
    assert.notEqual(altered,source,'Adversarial change must be real');
    assert.throws(()=>assertMetadataOnlyContract(altered));
  }
});

test('live result must contain exactly one clean result for each pinned function',()=>{
  const originals=[...signatures.keys()];
  const good=originals.map(name=>({name,exists_with_expected_signature:true,
    same_name_overload_count:1,verdict:'BASELINE_MATCH'}));
  const verify=rows=>rows.length===6 &&
    originals.every(name=>rows.filter(r=>r.name===name &&
      r.exists_with_expected_signature===true &&
      r.same_name_overload_count===1 && r.verdict==='BASELINE_MATCH').length===1);
  assert.equal(verify(good),true);
  assert.equal(verify(good.slice(1)),false);
  assert.equal(verify([...good,good[0]]),false);
  assert.equal(verify(good.map((r,i)=>i===0?{...r,verdict:'DRIFT'}:r)),false);
  assert.equal(verify(good.map((r,i)=>i===0?{...r,same_name_overload_count:2}:r)),false);
});
