import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { excelSafeCell, financialTotal, rentPeriodTotals, monthlyDateBounds } from '../src/core/accounting-export.ts';
import { renderInternalDocument } from '../src/core/financial-documents.ts';

const reports=readFileSync(new URL('../src/modules/reports/MonthlyAccountingReport.tsx',import.meta.url),'utf8');
const receipts=readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx',import.meta.url),'utf8');

test('Excel never evaluates user-origin spreadsheet formula cells',()=>{
  for (const input of ['=HYPERLINK("https://evil","x")',' +SUM(1,1)','@RISK','-1+2','\t=BAD()']){
    assert.equal(excelSafeCell(input),"'"+input);
  }
  assert.equal(excelSafeCell(123456),123456);
  assert.equal(excelSafeCell(null),'');
});

test('monthly dates honor December-to-January rollover and reject malformed month',()=>{
  assert.deepEqual(monthlyDateBounds('2026-12'),{start:'2026-12-01',end:'2027-01-01'});
  assert.deepEqual(monthlyDateBounds('2026-02'),{start:'2026-02-01',end:'2026-03-01'});
  assert.throws(()=>monthlyDateBounds('2026-13'));
});

test('tenant monthly totals never offset unpaid rent against another tenant overpayment',()=>{
  const result=rentPeriodTotals([
    {expected_amount:1500000,paid_amount:400000,status:'PARTIAL'},
    {expected_amount:500000,paid_amount:700000,status:'PAID'},
    {expected_amount:1000000,paid_amount:0,status:'CANCELLED'},
  ]);
  assert.deepEqual(result,{expected:2000000,paid:1100000,outstanding:1100000});
  assert.throws(()=>rentPeriodTotals([{expected_amount:-1,paid_amount:0,status:'PENDING'}]));
});

test('internal printable documents escape hostile names and do not falsely claim DIAN authorization',()=>{
  const html=renderInternalDocument({
    kind:'TENANT_ACCOUNT',issuer:'Mi Inmobiliaria <script>alert(1)</script>',
    recipient:'Juan & María',reference:'A100',period:'2026-10',currency:'COP',
    lines:[{concept:'Canon <img onerror=alert(1)>',amount:1500000}],
    recordedStatus:'PENDING',
  });
  assert.ok(html.includes('Mi Inmobiliaria &lt;script&gt;'));
  assert.ok(html.includes('Juan &amp; María'));
  assert.ok(html.includes('&lt;img onerror'));
  assert.doesNotMatch(html,/<script>alert/);
  assert.match(html,/NO ES FACTURA ELECTRÓNICA DIAN/);
  assert.throws(()=>renderInternalDocument({
    kind:'OWNER_SETTLEMENT',issuer:'A',recipient:'B',reference:'C',
    period:'2026-10',currency:'COP',recordedStatus:'PAID',
    lines:[{concept:'Neto',amount:NaN}],
  }));
});

test('Excel reporting is filtered by active tenant, date, permissions and full counts',()=>{
  assert.match(reports,/PERMISSIONS\.REPORTS_VIEW/);
  assert.match(reports,/MONTHLY_SECTIONS\.filter\(item => can\(item\.permission\)\)/);
  assert.match(reports,/\.eq\('organization_id', organizationId\)/);
  assert.match(reports,/\.gte\(section\.date,start\)\.lt\(section\.date,end\)/);
  assert.match(reports,/query\.count == null \|\| query\.count > rows\.length/);
  assert.match(reports,/XLSX\.utils\.book_append_sheet\(book,first,'Resumen'\)/);
  assert.match(reports,/XLSX\.writeFile\(book/);
  assert.match(reports,/excelSafeCell\(row\[col\]\)/);
  assert.match(reports,/No se exportan registros de otras inmobiliarias/);
});

test('statement buttons only print actual financial records, never issue payments',()=>{
  assert.match(receipts,/Emitir estado de cuenta/);
  assert.match(receipts,/Emitir liquidación/);
  assert.match(receipts,/disabled=\{!reconciled\}/);
  assert.match(receipts,/printInternalDocument/);
  assert.doesNotMatch(receipts,/\.from\('payment_orders'\)/);
  assert.match(dashboard,/isPlatformAdmin && <a href="\/super-admin"/);
});
