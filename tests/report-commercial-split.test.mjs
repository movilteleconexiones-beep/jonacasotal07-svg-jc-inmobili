import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectedWorkbookContent } from '../src/core/accounting-export.ts';

const panel=readFileSync(new URL('../src/modules/reports/ReportsModule.tsx',import.meta.url),'utf8');
const monthly=readFileSync(new URL('../src/modules/reports/MonthlyAccountingReport.tsx',import.meta.url),'utf8');

const available=[
  {name:'Cierres',columns:['id','stage','operation_type','closed_at','final_price','offered_price','asking_price','commission_amount'],rows:[
    {id:'v1',stage:'WON',operation_type:'SALE',closed_at:'2026-10-12',final_price:220000000,offered_price:230000000,commission_amount:6600000},
    {id:'a1',stage:'WON',operation_type:'RENT',closed_at:'2026-10-12',final_price:1800000,commission_amount:180000},
    {id:'a2',stage:'WON',operation_type:'RENT',closed_at:'2026-10-13',final_price:null,offered_price:900000,commission_amount:90000},
    {id:'adm',stage:'WON',operation_type:'ADMINISTRATION',closed_at:'2026-10-13',final_price:400000000,commission_amount:100000},
    {id:'lost',stage:'LOST',operation_type:'SALE',closed_at:'2026-10-13',final_price:90000000,commission_amount:5000000},
  ]},
  {name:'Administraciones',columns:['reference','reviewed_at','operation_type','status'],rows:[
    {reference:'CON-a',reviewed_at:'2026-10-12',operation_type:'ADMINISTRATION',status:'ACCEPTED',contact_phone:'secret'},
    {reference:'CON-b',reviewed_at:'2026-10-12',operation_type:'SALE',status:'ACCEPTED'},
    {reference:'CON-c',reviewed_at:'2026-10-12',operation_type:'ADMINISTRATION',status:'REJECTED'},
  ]},
  {name:'Liquidaciones',columns:['owner_id','lease_id','period_month','commission_amount','status'],rows:[
    {owner_id:'p1',lease_id:'l1',period_month:'2026-10',commission_amount:180000,status:'ISSUED'},
    {owner_id:'p2',lease_id:'l2',period_month:'2026-10',commission_amount:95000,status:'DRAFT'},
  ]},
];

test('monthly sales and rent export separate incompatible transaction amounts',()=>{
  const sales=selectedWorkbookContent({kind:'metric',key:'SALES_CLOSED'},available);
  const rentals=selectedWorkbookContent({kind:'metric',key:'RENTALS_CLOSED'},available);
  assert.equal(sales.total,220000000);
  assert.deepEqual(sales.rows.map(row=>row.id),['v1']);
  assert.equal(rentals.total,2700000);
  assert.deepEqual(rentals.rows.map(row=>row.id),['a1','a2']);
  assert.equal(selectedWorkbookContent({kind:'metric',key:'WON_DEALS'},available).total,4);
  assert.deepEqual(sales.columns,['id','closed_at','operation_type','stage','valor']);
});

test('commercial fees are agreed amounts, never mistaken for rent or cash receipts',()=>{
  const fees=selectedWorkbookContent({kind:'metric',key:'COMMERCIAL_FEES'},available);
  assert.equal(fees.total,6870000);
  assert.deepEqual(fees.rows.map(row=>row.valor),[6600000,180000,90000]);
});

test('accepted management intake is not conflated with rental contracts and exports no contact info',()=>{
  const captured=selectedWorkbookContent({kind:'metric',key:'ADMIN_CONSIGNMENTS'},available);
  assert.equal(captured.total,1);
  assert.deepEqual(captured.rows.map(row=>row.reference),['CON-a']);
  assert.ok(!captured.columns.includes('contact_phone'));
  assert.ok(!('contact_phone' in captured.rows[0]));
});

test('administration commission export only includes issued statements, not drafts',()=>{
  const income=selectedWorkbookContent({kind:'metric',key:'ADMIN_FEES'},available);
  assert.equal(income.total,180000);
  assert.equal(income.rows.length,1);
  assert.equal(income.rows[0].owner_id,'p1');
});

test('no silent co-mingling, cross-tenant queries or created_at used as closing date',()=>{
  for(const source of [panel,monthly]){
    assert.match(source,/\.eq\('organization_id',organizationId\)/);
    assert.match(source,/\.eq\('stage','WON'\)/);
    assert.match(source,/\.gte\('closed_at',start\+'T00:00:00-05:00'\)/);
    assert.match(source,/\.lt\('closed_at',end\+'T00:00:00-05:00'\)/);
  }
  assert.match(panel,/onMonthChange=\{changeMonth\}/);
  assert.match(monthly,/MONTHLY_MODULE_NAMES\.includes/);
  assert.match(monthly,/name:'Administraciones'/);
  assert.match(panel,/Comisiones pendientes · acumulado/);
  assert.match(panel,/no necesariamente cobradas/);
});
