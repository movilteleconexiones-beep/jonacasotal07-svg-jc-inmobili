import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import { parseCommissionPercentage, commissionValueFromRate } from '../src/core/commission-percentage.ts';

const entry=readFileSync(new URL('../src/modules/finance/OwnerSettlementEntry.tsx',import.meta.url),'utf8');
const sales=readFileSync(new URL('../src/modules/deals/DealsModule.tsx',import.meta.url),'utf8');
const commissions=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
const ledger=readFileSync(new URL('../src/modules/finance/OwnerDeductionLedger.tsx',import.meta.url),'utf8');
const backend=readFileSync(new URL('../supabase/migrations/20261013020000_owner_statement_percentage_commission.sql',import.meta.url),'utf8');

test('commission percentages accept 0–100 with two decimal places only',()=>{
  for(const x of ['0','10','10.5','10.25','99.99','100','100.00']) assert.ok(Number.isFinite(parseCommissionPercentage(x)),x);
  for(const x of ['-1','100.01','101','10.001','','abc','1e2','Infinity','NaN']) assert.ok(Number.isNaN(parseCommissionPercentage(x)),x);
});
test('commission amount is derived from percent of declared base with cent rounding',()=>{
  assert.equal(commissionValueFromRate(1800000,10),180000);
  assert.equal(commissionValueFromRate(1800000,12.5),225000);
  assert.equal(commissionValueFromRate(99.99,33.33),33.33);
  assert.equal(commissionValueFromRate(100,0),0);
  assert.equal(commissionValueFromRate(0.01,50),0.01);
  assert.ok(Number.isNaN(commissionValueFromRate(-5,10)));
  assert.ok(Number.isNaN(commissionValueFromRate(100,100.01)));
  assert.ok(Number.isNaN(commissionValueFromRate(Number.NaN,10)));
});
test('owner liquidation accepts percentage only and uses server-calculated amount',()=>{
  assert.match(entry,/Comisión inmobiliaria \(%\)/);
  assert.match(entry,/type="number" min="0" max="100" step="0.01"/);
  assert.match(entry,/commissionValueFromRate\(gross,commissionPercentage\)/);
  assert.match(entry,/Comisión calculada \(COP\)/);
  assert.match(entry,/create_owner_draft_statement_by_percentage/);
  assert.match(entry,/agency_commission_percentage:commissionPercentage/);
  assert.doesNotMatch(entry,/agency_commission:commissionNumber/);
  assert.match(backend,/derived_commission:=round\(paid_income\*agency_commission_percentage\/100,2\)/);
  assert.match(backend,/RETURN public.create_owner_draft_statement\(/);
  assert.match(backend,/p\.status<>'CANCELLED'/);
  assert.match(backend,/PERFORM 1 FROM public\.rent_payments p/);
});
test('deal and staff commission forms validate the rate rather than manual commission COP',()=>{
  assert.match(sales,/parseCommissionPercentage\(commission\)/);
  assert.match(sales,/Comisión inmobiliaria \(%\)/);
  assert.match(sales,/max="100" step="0.01"/);
  assert.match(commissions,/Porcentaje de comisión \(%\)/);
  assert.match(commissions,/parseCommissionPercentage\(String\(form\.get\('percentage'\)/);
  assert.match(commissions,/commissionValueFromRate\(basis,rate\)/);
  assert.match(commissions,/name="calculation_basis"/);
  assert.doesNotMatch(commissions,/name="amount" label=/);
  assert.match(commissions,/percentage: rate,\s*calculation_basis: basis,\s*amount,/);
  assert.match(ledger,/CONCEPTS\.filter\(\(\[code\]\)=>code!=='COMMISSION'\)/);
  assert.match(ledger,/evitar descuentos duplicados/);
});
