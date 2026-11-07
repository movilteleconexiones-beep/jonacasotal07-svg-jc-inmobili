import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sql=readFileSync(new URL('../security/tests/finance_test_tenant_rollback_e2e_96.sql',import.meta.url),'utf8');

test('#96 hosted finance rehearsal is hard-scoped to test tenant and rolls back all rows',()=>{
 assert.match(sql,/^BEGIN;/m);
 assert.match(sql,/SET LOCAL lock_timeout='5s'/);
 assert.match(sql,/SET LOCAL statement_timeout='40s'/);
 assert.match(sql,/o.slug='sistema-inmobiliario-jco'/);
 assert.match(sql,/ba\.is_test/);
 assert.match(sql,/jco_private\.operational_access\(org\)/);
 assert.match(sql,/SET LOCAL ROLE authenticated/);
 assert.match(sql,/RESET ROLE;\s*ROLLBACK;/);
 assert.match(sql,/FAIL: synthetic financial records persisted/);
 assert.doesNotMatch(sql,/\bCOMMIT\s*;/i);
 assert.doesNotMatch(sql,/\bservice_role\b/i);
 assert.doesNotMatch(sql,/\bDELETE\s+FROM\b/i);
});

test('#96 uses real effective rent and transactional receipt events',()=>{
 assert.match(sql,/SELECT expected_amount INTO expected/);
 assert.match(sql,/first_part:=round\(expected\*0\.3,2\)/);
 assert.match(sql,/receipt IS DISTINCT FROM repeated/);
 assert.match(sql,/EXCEPTION WHEN SQLSTATE '23514'/);
 assert.match(sql,/status FROM public\.rent_payments WHERE id=payment\)<>'PAID'/);
 assert.match(sql,/count\(\*\) FROM public\.rent_receipts WHERE rent_payment_id=payment/);
});

test('#96 requires owner-borne supported deductions, rejects unapproved and excludes tenant utilities',()=>{
 assert.match(sql,/'WATER','OWNER',120000/);
 assert.match(sql,/'ELECTRICITY','TENANT',70000/);
 assert.match(sql,/Reconciled an unapproved deduction/);
 assert.match(sql,/reconcile_owner_draft_statement_audited/);
 assert.match(sql,/net IS DISTINCT FROM expected-commission-30000-120000/);
});

test('#96 does not claim full release readiness without issuance/payout and independent roles',()=>{
 assert.match(sql,/No impersonation of a genuine login is claimed/);
 assert.doesNotMatch(sql,/admin_record_owner_payout\(/);
});
