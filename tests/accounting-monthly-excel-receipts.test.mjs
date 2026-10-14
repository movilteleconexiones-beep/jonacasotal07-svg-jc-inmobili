import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { excelSafeCell, financialTotal, rentPeriodTotals, monthlyDateBounds, selectedWorkbookContent } from '../src/core/accounting-export.ts';
import { renderInternalDocument } from '../src/core/financial-documents.ts';

const reports=readFileSync(new URL('../src/modules/reports/MonthlyAccountingReport.tsx',import.meta.url),'utf8');
const receipts=readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx',import.meta.url),'utf8');
const reportsParent=readFileSync(new URL('../src/modules/reports/ReportsModule.tsx',import.meta.url),'utf8');
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
  assert.match(reports,/\.gte\(dateColumn,start\)\.lt\(dateColumn,end\)/);
  assert.match(reports,/query\.count == null \|\| query\.count > rows\.length/);
  assert.match(reports,/XLSX\.utils\.book_append_sheet\(book,sheet,chosen\.sheetName\)/);
  assert.match(reports,/XLSX\.writeFile\(book/);
  assert.match(reports,/excelSafeCell\(row\[column\]\)/);
  assert.match(reports,/No se exportan registros de otras inmobiliarias/);
});

test('statement buttons only print actual financial records, never issue payments',()=>{
  assert.match(receipts,/Emitir estado de cuenta/);
  assert.match(receipts,/Generar comprobante/);
  assert.match(receipts,/disabled=\{!reconciled\}/);
  assert.match(receipts,/printInternalDocument/);
  assert.doesNotMatch(receipts,/\.from\('payment_orders'\)/);
  assert.match(dashboard,/isPlatformAdmin && <a href="\/super-admin"/);
});

test('an individual module selection exports exactly that module and not another',()=>{
  const available=[
    {name:'Clientes',columns:['first_name','phone'],rows:[{first_name:'Ana',phone:'3000000000'}]},
    {name:'Propietarios',columns:['first_name'],rows:[{first_name:'Juan'}]},
  ];
  const report=selectedWorkbookContent({kind:'module',name:'Clientes'},available);
  assert.equal(report.sheetName,'Clientes');
  assert.deepEqual(report.rows,[{first_name:'Ana',phone:'3000000000'}]);
  assert.deepEqual(report.columns,['first_name','phone']);
  assert.equal(report.total,null);
  assert.equal(available[1].rows[0].first_name,'Juan');
  assert.throws(()=>selectedWorkbookContent({kind:'module',name:'Contratos'},available),/autorización/);
});

test('selecting one monetary card exports only that KPI with period details',()=>{
  const available=[{name:'Cánones',columns:['lease_id','period_month','status','expected_amount','paid_amount'],
    rows:[
      {lease_id:'a',period_month:'2026-10',status:'PARTIAL',expected_amount:100000,paid_amount:20000},
      {lease_id:'b',period_month:'2026-10',status:'PAID',expected_amount:50000,paid_amount:60000},
      {lease_id:'c',period_month:'2026-10',status:'CANCELLED',expected_amount:30000,paid_amount:0},
    ]}];
  const pending=selectedWorkbookContent({kind:'metric',key:'PENDING_RENT'},available);
  assert.equal(pending.total,80000);
  assert.deepEqual(pending.rows.map(x=>x.valor),[80000,0]);
  assert.equal(pending.rows.length,2);
  assert.deepEqual(pending.columns,['lease_id','period_month','status','valor']);
  assert.equal(selectedWorkbookContent({kind:'metric',key:'RECORDED_RENT'},available).total,80000);
  assert.equal(selectedWorkbookContent({kind:'metric',key:'EXPECTED_RENT'},available).total,150000);
  assert.throws(()=>selectedWorkbookContent({kind:'metric',key:'OWNER_NET'},available),/autorización/);
});

test('individual owner net export cannot include other owner metrics or modules',()=>{
  const detail=selectedWorkbookContent({kind:'metric',key:'OWNER_NET'},[
    {name:'Liquidaciones',columns:['owner_id','net_amount','tax_amount','commission_amount','other_deductions'],
      rows:[{owner_id:'ownerA',lease_id:'leaseA',period_month:'2026-10',status:'DRAFT',net_amount:700000,tax_amount:50000,commission_amount:100000,other_deductions:80000}]},
  ]);
  assert.equal(detail.total,700000);
  assert.deepEqual(detail.rows.map(({valor})=>valor),[700000]);
  assert.equal(detail.rows[0].owner_id,'ownerA');
  assert.ok(!detail.columns.includes('tax_amount'));
  assert.ok(!detail.columns.includes('commission_amount'));
});

test('winning deals report contains only deals with WON status from the selected month',()=>{
  const detail=selectedWorkbookContent({kind:'metric',key:'WON_DEALS'},[
    {name:'Negocios',columns:['stage','created_at'],rows:[
      {stage:'WON',created_at:'2026-10-12'},
      {stage:'LOST',created_at:'2026-10-13'},
      {stage:'WON',created_at:'2026-10-14'},
    ]},
  ]);
  assert.equal(detail.total,2);
  assert.equal(detail.rows.length,2);
  assert.deepEqual(detail.rows.map(r=>r.valor),[1,1]);
});

test('monthly interface is single-select across cards and chips, not a bulk workbook',()=>{
  assert.match(reports,/selection: MonthlyReportSelection \| null/);
  assert.match(reports,/aria-pressed=\{isSelected\}/);
  assert.match(reports,/onSelect\(\{kind:'metric',key\}\)/);
  assert.match(reports,/onSelect\(\{kind:'module',name:/);
  assert.match(reports,/disabled=\{!ready\|\|exporting\|\|!selectionAvailable\}/);
  assert.match(reports,/selectedWorkbookContent\(selection,sheets\)/);
  assert.match(reports,/Ítem seleccionado/);
  assert.match(reports,/una sola hoja/);
  assert.doesNotMatch(reports,/for\(const section of sheets\)\s*\{\s*const grid/);
  assert.match(reportsParent,/aria-pressed=\{chosen\}/);
  assert.match(reportsParent,/selection=\{selectedReport\} onSelect=\{setSelectedReport\}/);
});
