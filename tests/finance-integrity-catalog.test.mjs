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
