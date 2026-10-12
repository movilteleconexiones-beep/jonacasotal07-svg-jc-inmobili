import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconcileOwnerDeductionLines } from '../src/core/owner-deduction-reconciliation.ts';

const statement = {
  gross_income: 1600000,
  commission_amount: 160000,
  tax_amount: 20000,
  other_deductions: 160000,
  net_amount: 1260000,
};
const approved = (category, party, amount) => ({
  category, responsible_party: party, amount, status: 'APPROVED',
});

test('owner ledger reconciles commissions, taxes and individually authorized expenses without double counting', () => {
  const result = reconcileOwnerDeductionLines(statement, [
    approved('WATER', 'OWNER', 100000),
    approved('MAINTENANCE', 'OWNER', 60000),
    approved('ELECTRICITY', 'TENANT', 70000),
    approved('REPAIRS', 'AGENCY', 35000),
    approved('COMMISSION', 'OWNER', 160000),
    approved('TAX', 'OWNER', 20000),
  ]);
  assert.equal(result.status, 'RECONCILED');
  assert.equal(result.expectedNet, 1260000);
  assert.equal(result.recordedNet, 1260000);
  assert.equal(result.detailed.other, 160000);
  assert.equal(result.detailed.commission, 160000);
  assert.equal(result.detailed.tax, 20000);
  assert.equal(result.detailed.tenant, 70000);
  assert.equal(result.detailed.agency, 35000);
  assert.equal(result.bankTransferConfirmed, false);
});

test('a tenant-owned utility is never deducted from landlord settlement', () => {
  const result = reconcileOwnerDeductionLines({
    gross_income: 1000000, commission_amount: 0, tax_amount: 0,
    other_deductions: 0, net_amount: 1000000,
  }, [approved('GAS', 'TENANT', 125000)]);
  assert.equal(result.status, 'RECONCILED');
  assert.equal(result.expectedNet, 1000000);
  assert.equal(result.detailed.tenant, 125000);
  assert.equal(result.detailed.other, 0);
});

test('unapproved expenses remain pending rather than lowering owner net', () => {
  const result = reconcileOwnerDeductionLines(statement, [
    approved('COMMISSION','OWNER',160000),
    approved('TAX','OWNER',20000),
    approved('WATER','OWNER',100000),
    {category:'MAINTENANCE',responsible_party:'OWNER',amount:60000,status:'DRAFT'},
  ]);
  assert.equal(result.status,'PENDING');
  assert.equal(result.detailed.other,100000);
  assert.equal(result.pending,1);
});

test('voided expenses remain visible in audit counts but do not lower owner net', () => {
  const result = reconcileOwnerDeductionLines({
    gross_income: 500000, commission_amount: 0, tax_amount: 0,
    other_deductions: 0, net_amount: 500000,
  }, [{category:'WATER',responsible_party:'OWNER',amount:80000,status:'VOIDED'}]);
  assert.equal(result.voided,1);
  assert.equal(result.detailed.other,0);
  assert.equal(result.status,'RECONCILED');
});

test('missing itemized details and accounting discrepancies must not be shown as reconciled', () => {
  const noDetails = reconcileOwnerDeductionLines(statement,[]);
  assert.equal(noDetails.status,'NO_DETAILS');
  const mismatched = reconcileOwnerDeductionLines(statement, [
    approved('COMMISSION','OWNER',160000),
    approved('TAX','OWNER',20000),
    approved('WATER','OWNER',50000),
  ]);
  assert.equal(mismatched.status,'MISMATCH');
  const inaccurateNet = reconcileOwnerDeductionLines({...statement,net_amount:1300000},[
    approved('COMMISSION','OWNER',160000),
    approved('TAX','OWNER',20000),
    approved('WATER','OWNER',160000),
  ]);
  assert.equal(inaccurateNet.status,'MISMATCH');
});

test('rejects negative, malformed and out-of-range financial amounts', () => {
  for (const bad of [-1,'invalid','1e99']) {
    assert.throws(() => reconcileOwnerDeductionLines(statement, [approved('WATER','OWNER',bad)]));
  }
});

test('migration uses tenant-composite FK and keeps Wompi outside owner deductions', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261012120000_owner_statement_deduction_lines.sql', import.meta.url),'utf8');
  assert.match(sql, /FOREIGN KEY \(organization_id, statement_id\)/);
  assert.match(sql, /public\.has_org_permission\(organization_id, 'owner_statements\.view'\)/);
  assert.match(sql, /public\.has_org_permission\(organization_id, 'owner_statements\.create'\)/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.match(sql, /status IN \('DRAFT','APPROVED','VOIDED'\)/);
  assert.match(sql, /NEW\.updated_at := now\(\)/);
  assert.doesNotMatch(sql,/WOMPI_PUBLIC_KEY|WOMPI_PRIVATE_KEY|payment_orders/);
});
