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
    if(!p || p.permissive!==expected || p.roles!=='{authenticated}' ||
      !/^[0-9a-f]{32}$/.test(p.using_md5) || !/^[0-9a-f]{32}$/.test(p.with_check_md5))
      errors.push('Financial policy metadata mismatch: '+name);
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
