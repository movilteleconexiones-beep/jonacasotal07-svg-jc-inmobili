import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const ui=readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261013010000_safe_future_rent_amendments_and_unpaid_corrections.sql',import.meta.url),'utf8');

test('each lease shows a controlled future rent editor and versioned rates',()=>{
  assert.match(ui,/Editar canon futuro/);
  assert.match(ui,/Programar nuevo canon mensual/);
  assert.match(ui,/Desde \{a\.effective_month\.slice\(0,7\)\}/);
  assert.match(ui,/signed_addendum_reference:reference/);
  assert.match(ui,/request_key:crypto\.randomUUID\(\)/);
  assert.match(ui,/canAmend = allowed && admin && can\(PERMISSIONS\.LEASES_EDIT\)/);
  assert.match(sql,/lease_rent_amendment_one_per_month UNIQUE/);
  assert.match(sql,/target_month<=\(date_trunc\('month',now\(\) AT TIME ZONE 'America\/Bogota'\)\)::date/);
  assert.match(sql,/target_month>date_trunc\('month',lease_row\.end_date\)::date/);
  assert.match(sql,/period_month>=target_month/);
  assert.match(sql,/request_key=request_key/);
  assert.match(sql,/effective_month<=target_period/);
  assert.match(sql,/VALUES \(target_org,target_lease,target_period,period_rent,0,'PENDING'\)/);
});

test('unpaid period amount may be corrected only by audited admin-only RPC',()=>{
  assert.match(ui,/Corregir cobro/);
  assert.match(ui,/saveUnpaidCorrection/);
  assert.match(ui,/canCorrect = allowed && admin && can\(PERMISSIONS\.RENT_PAYMENTS_CREATE\)/);
  assert.match(ui,/correct_unpaid_rent_period/);
  assert.match(sql,/entry\.paid_amount<>0/);
  assert.match(sql,/public\.rent_receipts/);
  assert.match(sql,/public\.owner_statements/);
  assert.match(sql,/entry\.status NOT IN \('PENDING','LATE'\)/);
  assert.match(sql,/rent_period\.amount_corrected/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.correct_unpaid_rent_period/);
});

test('paid receipts are never directly edited, only an auditable review request is allowed',()=>{
  assert.match(ui,/Solicitar revisión/);
  assert.match(ui,/request_paid_rent_review/);
  assert.match(ui,/Este período tiene pagos registrados/);
  assert.match(ui,/paid_amount>0/);
  assert.match(sql,/rent_period\.review_requested/);
  assert.match(sql,/RETURNING id INTO event_id/);
  assert.doesNotMatch(sql,/UPDATE public\.rent_receipts|DELETE FROM public\.rent_receipts/);
  assert.doesNotMatch(sql,/UPDATE public\.owner_statements|DELETE FROM public\.owner_statements/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.request_paid_rent_review/);
  assert.match(ui,/window\.dispatchEvent\(new Event\('tenant-rent-updated'\)\)/);
});
