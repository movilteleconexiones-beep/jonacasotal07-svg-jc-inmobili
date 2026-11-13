import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const ddl=readFileSync(new URL('../security/candidates/g09_shared_owner_financial_drafts_REVIEW_ONLY.sql',import.meta.url),'utf8');
const qa=readFileSync(new URL('../security/tests/g09_shared_owner_clone_rollback.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('../security/ops/g09_shared_owner_revert_only_if_unused.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/finance/OwnerSettlementEntry.tsx',import.meta.url),'utf8');

test('G09 migration is explicit, transactional and never modifies historical statements directly',()=>{
 assert.match(ddl,/^BEGIN;/m);
 assert.match(ddl,/^COMMIT;/m);
 assert.match(ddl,/current_user<>'postgres'/);
 assert.match(ddl,/to_regclass\('public\.property_ownerships'\)/);
 assert.match(ddl,/CREATE FUNCTION public\.create_owner_shared_drafts\(/);
 assert.match(ddl,/REVOKE ALL ON FUNCTION public\.create_owner_shared_drafts\([\s\S]*FROM PUBLIC,anon,authenticated/);
 assert.match(ddl,/GRANT EXECUTE ON FUNCTION public\.create_owner_shared_drafts\([\s\S]*TO authenticated/);
 assert.match(ddl,/IF auth\.uid\(\) IS NULL/);
 assert.match(ddl,/NOT public\.commission_is_manager\(target_org\)/);
 assert.match(ddl,/NOT public\.has_org_permission\(target_org,'owner_statements.create'\)/);
 assert.doesNotMatch(ddl,/\bDELETE\s+FROM\s+public\.(?:owner_statements|rent_receipts|owner_statement_payouts)\b/i);
 assert.doesNotMatch(ddl,/\bUPDATE\s+public\.(?:owner_statement_payouts|rent_receipts)\b/i);
 assert.doesNotMatch(ddl,/\bCOPY\s+\b|\bhttp_post\b|\bpg_net\b/i);
});

test('G09 preserves whole-cent sums, validates 100 percent and locks the lease',()=>{
 assert.match(ddl,/pg_catalog\.floor\(p_amount \* 100 \* po\.ownership_percentage \/ 100\)/);
 assert.match(ddl,/ORDER BY f\.residue DESC,f\.owner_id/);
 assert.match(ddl,/v_sum<>100/);
 assert.match(ddl,/agency_commission_percentage<>pg_catalog\.round\(agency_commission_percentage,2\)/);
 assert.match(ddl,/agency_commission_percentage>100/);
 assert.match(ddl,/v_commission:=pg_catalog\.round\(v_income\*agency_commission_percentage\/100,2\)/);
 assert.match(ddl,/v_primary<>1/);
 assert.match(ddl,/v_primary_id IS DISTINCT FROM v_lease\.owner_id/);
 assert.match(ddl,/FROM public\.leases WHERE id=target_lease\s+AND organization_id=target_org FOR UPDATE/);
 assert.match(ddl,/EXISTS\(SELECT 1 FROM public\.owner_statements s/);
 assert.match(ddl,/FOR SHARE/);
 assert.match(ddl,/INSERT INTO public\.audit_log/);
 assert.match(ddl,/owner_statement\.shared_draft_created/);
 assert.match(ddl,/CREATE TRIGGER owner_statements_shared_cap/);
 assert.match(ddl,/BEFORE INSERT OR UPDATE OF owner_id,lease_id,period_month,gross_income/);
 assert.match(ddl,/WHEN (?:.+)?/); // static compatibility check only
});

test('G09 reconciliation must use share allocation instead of entire period income',()=>{
 assert.match(ddl,/CREATE OR REPLACE FUNCTION public\.reconcile_owner_draft_statement\(/);
 assert.match(ddl,/jco_private\.allocate_owner_amount\(v_property_id,collected\)/);
 assert.match(ddl,/collected:=split_gross/);
 assert.match(ddl,/IF net_total<0 THEN RAISE EXCEPTION/);
 assert.match(ddl,/SET gross_income=collected,other_deductions=approved_other,net_amount=net_total/);
});

test('G09 UI shows shares and routes shared to dedicated RPC; old single-owner unchanged',()=>{
 assert.match(ui,/select\('id,owner_id,property_id,contract_number,status'\)/);
 assert.match(ui,/from\('property_ownerships'\)/);
 assert.match(ui,/const hasMultipleOwners=propertyShares.length>1/);
 assert.match(ui,/const sharesValid=!hasMultipleOwners/);
 assert.match(ui,/sharesValid/);
 assert.match(ui,/rpc\('create_owner_shared_drafts'/);
 assert.match(ui,/agency_commission_percentage:commissionPercentage/);
 assert.doesNotMatch(ui,/agency_commission:commissionNumber/);
 assert.match(ui,/rpc\('create_owner_draft_statement_by_percentage'/);
 assert.match(ui,/no se transfirió dinero/);
 assert.match(ui,/Array\.isArray\(data\)/);
 assert.doesNotMatch(ui,/\.from\('owner_statements'\)\.insert\(/);
});

test('G09 hosted finance rehearsal explicitly simulates JWT and rolls back, no bank money',()=>{
 assert.match(qa,/SET LOCAL ROLE authenticated/);
 assert.match(qa,/G09 deterministic 60\/40 cents incorrect/);
 assert.match(qa,/v_tot\.gross<>100\.01/);
 assert.match(qa,/v_tot\.net<>87\.98/);
 assert.match(qa,/G09 FAIL: old RPC allocated all shared rent/);
 assert.match(qa,/G09 FAIL: duplicate statements allowed/);
 assert.match(qa,/G09 FAIL: percentages totaling 90 allowed/);
 assert.match(qa,/G09 FAIL: cross-tenant allowed/);
 assert.match(qa,/QA-G09-NO-MONEY/);
 assert.match(qa,/ROLLBACK;/);
 assert.doesNotMatch(qa,/\bCOMMIT\s*;/i);
 assert.match(qa,/b\.is_test/);
});

test('G09 exact pre-migration rollback refuses to erase used owner settlements',()=>{
 assert.match(rollback,/c3e1ce9d703bc89c940db384cfc7d405/);
 assert.match(rollback,/BEGIN;/);
 assert.match(rollback,/^COMMIT;/m);
 assert.match(rollback,/current_user<>'postgres'/);
 assert.match(rollback,/shared_draft_created/);
 assert.match(rollback,/multi-owner activity already exists/);
 assert.match(rollback,/DROP TRIGGER owner_statements_shared_cap/);
 assert.match(rollback,/DROP FUNCTION public\.create_owner_shared_drafts/);
 assert.match(rollback,/CREATE OR REPLACE FUNCTION public\.reconcile_owner_draft_statement/);
 assert.match(rollback,/DROP FUNCTION jco_private\.allocate_owner_amount/);
 assert.doesNotMatch(rollback,/DELETE FROM public\.owner_statements|UPDATE public\.owner_statements/i);
});
