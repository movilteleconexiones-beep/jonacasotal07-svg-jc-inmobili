import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rentalBalance, ownerNetFromDeductions, parseMoneyInput } from '../src/core/rent-owner-money.ts';

const source = readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx', import.meta.url), 'utf8');
const clients = readFileSync(new URL('../src/modules/contacts/ContactsModule.tsx', import.meta.url), 'utf8');
const owners = readFileSync(new URL('../src/modules/owners/OwnersModule.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx', import.meta.url), 'utf8');

test('money inputs accept exact cents and reject invalid, overprecise or excessive amounts', () => {
  for (const value of ['0.29', '1000.01', '0.01', '999999999999.99'])
    assert.equal(parseMoneyInput(value), Number(value));
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1e3', '0.001', '1000000000000', '', null])
    assert.ok(Number.isNaN(parseMoneyInput(value)), String(value));
  assert.equal(parseMoneyInput('0', true), 0);
});

test('tenant rent balances show unpaid amount only from an explicitly recorded billing period', () => {
  assert.equal(rentalBalance(1600000, 1600000), 0);
  assert.equal(rentalBalance(1600000, 600000), 1000000);
  assert.equal(rentalBalance(1600000, 1700000), 0);
  assert.match(source, /no deudas inferidas/);
  assert.match(source, /no se puede calcular cartera vencida/);
  assert.match(source, /leases'\)\.select\('id,tenant_id,contract_number,monthly_rent,status'\)/);
  assert.match(source, /rent_payments'\)\.select\('id,lease_id,period_month,expected_amount,paid_amount,status'\)/);
});

test('owner net amounts subtract agency commission, taxes and other property deductions', () => {
  assert.equal(ownerNetFromDeductions({gross_income: 1600000,commission_amount: 160000,tax_amount: 30000,other_deductions: 120000}),1290000);
  assert.equal(ownerNetFromDeductions({gross_income: 500000,commission_amount: 200000,tax_amount: 0,other_deductions: 350000}),-50000);
  assert.match(source, /Math\.abs\(calculated - amount\(statement\.net_amount\)\) < 0\.01/);
  assert.match(source, /Por conciliar/);
  assert.match(source, /Los servicios públicos y demás conceptos aún están agrupados/);
});

test('financial queries never read another organization and never write financial transfers', () => {
  assert.match(source, /can\(PERMISSIONS\.RENT_PAYMENTS_VIEW\) && can\(PERMISSIONS\.LEASES_VIEW\)/);
  assert.match(source, /can\(PERMISSIONS\.OWNER_STATEMENTS_VIEW\)/);
  assert.equal((source.match(/\.eq\('organization_id', organizationId\)/g) || []).length,5);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.match(source, /if \(cancelled\) return/);
  assert.match(source, /El estado registrado no confirma por sí solo una transferencia bancaria/);
});

test('financial summaries appear only inside corresponding tenant modules and keep dual access', () => {
  assert.match(clients, /TenantRentBalanceSummary key=\{organizationId\} organizationId=\{organizationId\}/);
  assert.match(owners, /OwnerNetStatementsSummary key=\{organizationId\} organizationId=\{organizationId\}/);
  assert.match(owners, /formElement\.reset\(\)/);
  assert.match(dashboard, /isPlatformAdmin && <a href="\/super-admin"/);
});
