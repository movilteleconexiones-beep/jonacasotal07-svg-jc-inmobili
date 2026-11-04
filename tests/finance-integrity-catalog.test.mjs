import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=JSON.parse(readFileSync(join(root,'docs/ops/snapshots/finance-integrity-catalog-2026-11-02.json'),'utf8'));
const expectedReferences={
  leases_owner_same_tenant_fk:'property_owners(organization_id, id)',
  leases_property_same_tenant_fk:'properties(organization_id, id)',
  leases_tenant_same_tenant_fk:'contacts(organization_id, id)',
  owner_deductions_statement_same_tenant_fk:'owner_statements(organization_id, id)',
  owner_statement_lease_same_org_fk:'leases(organization_id, id)',
  owner_statement_owner_same_tenant_fk:'property_owners(organization_id, id)',
  rent_payments_lease_same_org_fk:'leases(organization_id, id)',
  rent_receipts_period_same_org_fk:'rent_payments(organization_id, id)',
};
const financialChecks=['leases_financial_amount_valid','rent_payment_financial_amounts_valid','owner_statement_financial_amounts_valid'];
const restrictive=['leases_financial_insert','leases_financial_update','leases_financial_view','owner_statement_financial_view','rent_payments_financial_view'];
const permissive=['owner_deductions_insert','owner_deductions_update_status','owner_deductions_view','rent_receipts_view'];
// Frozen fingerprints of the read-only 2026-11-02 catalog. This validates the
// captured evidence, NOT current production state or historical DDL equivalence.
// A syntactically valid but changed MD5 must never silently pass the audit.
const expectedPolicyCatalog=Object.freeze({
  leases_financial_insert:['leases','INSERT','d41d8cd98f00b204e9800998ecf8427e','e34f82df28865de1ea38a4b8c6ea8cef'],
  leases_financial_update:['leases','UPDATE','df97fd366d15a6d95aedaefc9beb56a1','df97fd366d15a6d95aedaefc9beb56a1'],
  leases_financial_view:['leases','SELECT','ea412a8206710ac9c4f95952abf6576a','d41d8cd98f00b204e9800998ecf8427e'],
  owner_deductions_insert:['owner_statement_deductions','INSERT','d41d8cd98f00b204e9800998ecf8427e','81f3fdcc150849526e90ad85db6b347e'],
  owner_deductions_update_status:['owner_statement_deductions','UPDATE','9f9f2f9924cfc3087594129af818a418','9f9f2f9924cfc3087594129af818a418'],
  owner_deductions_view:['owner_statement_deductions','SELECT','bc0bfc9c1e8a2be98ff909247edb6ba5','d41d8cd98f00b204e9800998ecf8427e'],
  owner_statement_financial_view:['owner_statements','SELECT','8a01b76618aab663b4fe604a042040f0','d41d8cd98f00b204e9800998ecf8427e'],
  rent_payments_financial_view:['rent_payments','SELECT','167cc9fc71b02a7ac9e1cbc6c1b4f8af','d41d8cd98f00b204e9800998ecf8427e'],
  rent_receipts_view:['rent_receipts','SELECT','84fc755bf693516b60997bd5e61036f9','d41d8cd98f00b204e9800998ecf8427e'],
});


export function evaluateFinanceCatalog(catalog) {
  const errors=[];
  if(!catalog || !Array.isArray(catalog.constraints) || !Array.isArray(catalog.policies) || !Array.isArray(catalog.tables))
    return {ok:false,errors:['Malformed finance catalog snapshot']};
  const byConstraint=new Map(catalog.constraints.map(c=>[c.conname,c]));
  for(const [name,reference] of Object.entries(expectedReferences)){
    const c=byConstraint.get(name);
    if(!c || c.contype!=='f' || !c.definition.includes('FOREIGN KEY (organization_id,') || !c.definition.includes('REFERENCES '+reference))
      errors.push('Missing/composite tenant FK mismatch: '+name);
  }
  for(const name of financialChecks){
    const c=byConstraint.get(name);
    if(!c || c.contype!=='c' || !c.definition.includes('CHECK (') || !c.definition.includes('999999999999.99'))
      errors.push('Financial numeric CHECK mismatch: '+name);
  }
  for(const name of [...restrictive,...permissive]){
    const p=catalog.policies.find(row=>row.policyname===name);
    const expected=restrictive.includes(name)?'RESTRICTIVE':'PERMISSIVE';
    const baseline=expectedPolicyCatalog[name];
    if(!p || p.permissive!==expected || p.roles!=='{authenticated}' ||
      p.tablename!==baseline[0] || p.cmd!==baseline[1] ||
      p.using_md5!==baseline[2] || p.with_check_md5!==baseline[3])
      errors.push('Financial policy metadata or captured expression mismatch: '+name);
  }
  const tables=new Set(catalog.tables.filter(t=>t.rls_enabled===true).map(t=>t.table_name));
  for(const name of ['leases','rent_payments','rent_receipts','owner_statements','owner_statement_deductions'])
    if(!tables.has(name)) errors.push('RLS not verified in captured catalog: '+name);
  return {ok:errors.length===0,errors,ddl_historical_equivalence_proven:false,db_push_authorized:false};
}

test('captured catalog contains eight composite-tenant FKs, three financial checks and nine finance policies',()=>{
  assert.equal(snapshot.constraints.length,11);
  assert.equal(snapshot.policies.length,9);
  assert.equal(snapshot.tables.length,5);
  const result=evaluateFinanceCatalog(snapshot);
  assert.equal(result.ok,true,result.errors.join('; '));
  assert.equal(result.ddl_historical_equivalence_proven,false);
  assert.equal(result.db_push_authorized,false);
});
test('fail closed on missing cross-organization FK or numeric safety CHECK',()=>{
  const noTenantFk={...snapshot,constraints:snapshot.constraints.filter(c=>c.conname!=='leases_property_same_tenant_fk')};
  assert.match(evaluateFinanceCatalog(noTenantFk).errors.join(';'),/leases_property_same_tenant_fk/);
  const weaker={...snapshot,constraints:snapshot.constraints.map(c=>c.conname==='rent_payment_financial_amounts_valid'?{...c,definition:'CHECK (true)'}:c)};
  assert.match(evaluateFinanceCatalog(weaker).errors.join(';'),/rent_payment_financial_amounts_valid/);
});
test('fail closed if a restrictive tenant finance read policy becomes permissive or RLS disabled',()=>{
  const weaker={...snapshot,policies:snapshot.policies.map(p=>p.policyname==='leases_financial_view'?{...p,permissive:'PERMISSIVE'}:p)};
  assert.match(evaluateFinanceCatalog(weaker).errors.join(';'),/leases_financial_view/);
  const unprotected={...snapshot,tables:snapshot.tables.map(t=>t.table_name==='owner_statements'?{...t,rls_enabled:false}:t)};
  assert.match(evaluateFinanceCatalog(unprotected).errors.join(';'),/owner_statements/);
});

test('fail closed when captured policy expression hash changes but remains valid MD5',()=>{
  const changed={...snapshot,policies:snapshot.policies.map(p=>
    p.policyname==='owner_deductions_insert'
      ? {...p,with_check_md5:'00000000000000000000000000000000'}
      : p)};
  assert.match(evaluateFinanceCatalog(changed).errors.join(';'),/owner_deductions_insert/);
  const moved={...snapshot,policies:snapshot.policies.map(p=>
    p.policyname==='rent_receipts_view'?{...p,tablename:'owner_statements',cmd:'UPDATE'}:p)};
  assert.match(evaluateFinanceCatalog(moved).errors.join(';'),/rent_receipts_view/);
});


// Additional READ-ONLY 2026-11-02 catalog coverage for #104. This checks
// recorded evidence and selected source statements, not live DB or full DDL.
const financeSurfaceExpectedGrants=Object.freeze({
// Required business grants only. MAINTAIN is not a required API grant;
  // its presence is an unresolved security finding, never a regression target.
  leases:['insert','select','update'],
  owner_statement_deductions:['insert','select','update'],
  owner_statements:['select'],
  rent_payments:['select'],
  rent_receipts:['select'],
});
const financeSurfaceSources=Object.freeze({
  owner_deductions_statement_created_idx:'20261012120000_owner_statement_deduction_lines.sql',
  rent_receipts_period_idx:'20261012130000_rent_receipts_and_owner_drafts.sql',
  owner_statement_deductions_guard:'20261012120000_owner_statement_deduction_lines.sql',
  aaa_owner_deductions_server_timestamps:'20261012150000_finance_approval_and_audit_timestamp_hardening.sql',
});
const expectedSurfaceDefinitions=Object.freeze({
  owner_deductions_statement_created_idx:/USING btree \(organization_id, statement_id, created_at DESC\)/,
  rent_receipts_period_idx:/USING btree \(organization_id, rent_payment_id, created_at\)/,
  owner_statement_deductions_guard:/BEFORE INSERT OR DELETE OR UPDATE ON owner_statement_deductions FOR EACH ROW EXECUTE FUNCTION guard_owner_statement_deduction_change\(\)/,
  aaa_owner_deductions_server_timestamps:/BEFORE INSERT ON owner_statement_deductions FOR EACH ROW EXECUTE FUNCTION normalize_owner_deduction_audit_fields\(\)/,
});

export function evaluateFinanceSurfaceAudit(surface) {
  const errors=[];
  if (!surface || !Array.isArray(surface.access) || !Array.isArray(surface.indexes) ||
      !Array.isArray(surface.triggers))
    return {captured_consistent:false,errors:['Malformed finance surface audit'],review_required:[],safe_to_push:false};
  const review_required=[];
  if (surface.inventory?.indexes!==23 || surface.inventory?.triggers!==9)
    errors.push('Observed inventory count changed');
  for (const [table,expected] of Object.entries(financeSurfaceExpectedGrants)) {
    for (const role of ['anon','authenticated']) {
      const row=surface.access.find(x=>x.table_name===table && x.role_name===role);
      if (!row || !row.privileges) { errors.push('Missing ACL '+table+'/'+role); continue; }
      const actual=Object.entries(row.privileges).filter(([name,allowed])=>allowed===true && name!=='maintain').map(([name])=>name).sort();
      if (JSON.stringify(actual)!==JSON.stringify(role==='anon'?[]:expected))
        errors.push('Effective ACL differs '+table+'/'+role);
      if (role==='anon' && row.privileges.maintain===true)
        errors.push('Unexpected anon MAINTAIN '+table);
      if (role==='authenticated' && row.privileges.maintain===true)
        review_required.push(table+': authenticated MAINTAIN');
    }
  }
  for (const [name,pattern] of Object.entries(expectedSurfaceDefinitions)) {
    const isIndex=name.endsWith('_idx');
    const row=(isIndex?surface.indexes:surface.triggers).find(x=>x.name===name);
    if (!row || !pattern.test(row.definition||'') ||
        (isIndex && (row.valid!==true || row.unique_flag!==false)) ||
        (!isIndex && row.enabled!=='O'))
      errors.push('Missing, invalid or changed '+(isIndex?'index ':'trigger ')+name);
  }
  return {captured_consistent:errors.length===0,errors,review_required,safe_to_push:false};
}

test('captured effective ACL, 2 indexes and 2 triggers agree with historical SQL names and shapes',()=>{
  const surface=snapshot.finance_surface_audit;
  const result=evaluateFinanceSurfaceAudit(surface);
  assert.equal(result.captured_consistent,true,result.errors.join('; '));
  assert.equal(surface.access.length,10);
  assert.equal(surface.indexes.length,2);
  assert.equal(surface.triggers.length,2);
  for (const [name,file] of Object.entries(financeSurfaceSources)) {
    const sql=readFileSync(join(root,'supabase/migrations',file),'utf8');
    assert.match(sql,new RegExp('CREATE\\s+'+(name.endsWith('_idx')?'INDEX':'TRIGGER')+'\\s+'+name+'\\b'));
  }
  assert.deepEqual(result.review_required,[
    'leases: authenticated MAINTAIN',
    'owner_statements: authenticated MAINTAIN',
    'rent_payments: authenticated MAINTAIN',
  ]);
  assert.equal(result.safe_to_push,false);
});

test('MAINTAIN is not required by API clients: revocation is safe for the captured audit',()=>{
  const tightened=structuredClone(snapshot.finance_surface_audit);
  for (const row of tightened.access) if (row.role_name==='authenticated') row.privileges.maintain=false;
  const result=evaluateFinanceSurfaceAudit(tightened);
  assert.equal(result.captured_consistent,true,result.errors.join('; '));
  assert.deepEqual(result.review_required,[]);
  assert.equal(result.safe_to_push,false); // Still blocked by migration drift.
  const exposed=structuredClone(snapshot.finance_surface_audit);
  exposed.access.find(x=>x.table_name==='leases'&&x.role_name==='anon').privileges.maintain=true;
  assert.match(evaluateFinanceSurfaceAudit(exposed).errors.join(';'),/Unexpected anon MAINTAIN leases/);
});

test('finance surface audit fails closed for unexpected grants, disabled triggers or invalid indexes',()=>{
  const original=snapshot.finance_surface_audit;
  const exposed=structuredClone(original);
  exposed.access.find(x=>x.table_name==='leases'&&x.role_name==='anon').privileges.select=true;
  assert.match(evaluateFinanceSurfaceAudit(exposed).errors.join(';'),/leases\/anon/);
  const writable=structuredClone(original);
  writable.access.find(x=>x.table_name==='rent_payments'&&x.role_name==='authenticated').privileges.delete=true;
  assert.match(evaluateFinanceSurfaceAudit(writable).errors.join(';'),/rent_payments\/authenticated/);
  const noGuard=structuredClone(original);
  noGuard.triggers.find(x=>x.name==='owner_statement_deductions_guard').enabled='D';
  assert.match(evaluateFinanceSurfaceAudit(noGuard).errors.join(';'),/owner_statement_deductions_guard/);
  const brokenIndex=structuredClone(original);
  brokenIndex.indexes.find(x=>x.name==='rent_receipts_period_idx').valid=false;
  assert.match(evaluateFinanceSurfaceAudit(brokenIndex).errors.join(';'),/rent_receipts_period_idx/);
});
