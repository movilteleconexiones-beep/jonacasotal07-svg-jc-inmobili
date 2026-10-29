import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { rentPeriodCanonDiscrepancy as discrepancy } from '../src/core/rent-period-canon-audit.ts';

const summary = readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx', import.meta.url),'utf8');
const period = (lease_id, period_month, expected_amount, status='PENDING') =>
  ({lease_id, period_month, expected_amount, status});
const future = [{lease_id:'apt1088', effective_month:'2026-11-01', new_monthly_rent:1700000}];

test('October 1088 charge is flagged while the November addendum does not apply retroactively',()=>{
  assert.deepEqual(discrepancy(1300000,period('apt1088','2026-10-01',1700000),future),{
    period:'2026-10',referenceCanon:1300000,recordedCanon:1700000,
    difference:400000,direction:'superior',reference:'CONTRATO',
  });
  assert.equal(discrepancy(1300000,period('apt1088','2026-11-01',1700000),future),null);
  assert.equal(discrepancy(1800000,period('apt0001','2026-10-01',1800000),future),null);
});

test('the latest applicable signed addendum wins regardless of sorting; other leases cannot affect it',()=>{
  const amendments=[
    {lease_id:'a',effective_month:'2027-01-01',new_monthly_rent:1850000},
    {lease_id:'another',effective_month:'2026-01-01',new_monthly_rent:900},
    {lease_id:'a',effective_month:'2026-10-01',new_monthly_rent:1700000},
  ];
  assert.equal(discrepancy(1300000,period('a','2026-12-01',1700000),amendments),null);
  assert.deepEqual(discrepancy(1300000,period('a','2027-01-01',1800000),amendments),{
    period:'2027-01',referenceCanon:1850000,recordedCanon:1800000,
    difference:50000,direction:'inferior',reference:'OTROSI',
  });
});

test('cancelled, missing or malformed amounts and periods never generate misleading warnings',()=>{
  assert.equal(discrepancy(1300000,period('a','2026-10-01',1700000,'CANCELLED'),[]),null);
  assert.equal(discrepancy(null,period('a','2026-10-01',1700000),[]),null);
  assert.equal(discrepancy(1300000,period('a','2026-13-01',1700000),[]),null);
  assert.equal(discrepancy(1300000,period('a','2026-10-22',1700000),[]),null);
  assert.equal(discrepancy(1300000,period('a','2026-10-01',0),[]),null);
  assert.equal(discrepancy(1300000,period('a','2026-10-01',1700000.001),[]),null);
});

test('read-only per-tenant finance UI clearly shows mismatch without rewriting payments',()=>{
  assert.match(summary,/rentPeriodCanonDiscrepancy/);
  assert.match(summary,/Cánones registrados por revisar/);
  assert.match(summary,/Referencia documental/);
  assert.match(summary,/No modifica cobros, recibos ni liquidaciones/);
  assert.match(summary,/amendments\.length < 200/);
  assert.match(summary,/\.eq\('organization_id', organizationId\)/);
  assert.doesNotMatch(summary,/\.from\('rent_payments'\)\.update\(/);
});

test('signed-canon correction proposal requires administrator permissions and explicit evidence review',()=>{
  assert.match(summary,/const canCorrect = allowed && admin && can\(PERMISSIONS\.RENT_PAYMENTS_CREATE\)/);
  assert.match(summary,/const canEditThisPayment = unpaid \? canCorrect : canReview&&payment\.paid_amount>0/);
  assert.match(summary,/Revisar canon y corregir/);
  assert.match(summary,/defaultValue=\{difference\?\.referenceCanon \?\? payment\.expected_amount\}/);
  assert.match(summary,/form\.get\('verified_canon'\) !== 'yes'/);
  assert.match(summary,/name="verified_canon" value="yes"/);
  assert.match(summary,/Verifiqué el contrato firmado y sus otrosíes/);
  assert.match(summary,/saveUnpaidCorrection\(event,payment,Boolean\(difference\)\)/);
  assert.match(summary,/supabase\.rpc\('correct_unpaid_rent_period'/);
  assert.match(summary,/supabase\.rpc\('request_paid_rent_review'/);
  assert.doesNotMatch(summary,/\.from\('rent_payments'\)\.update\(/);
});
