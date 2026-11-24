import assert from 'node:assert/strict';

export async function runSettlementJourney({page,menu,admin,org,lease,contract,checked}){
 const period='2026-11-01';
 const reason='Ensayo ficticio QA203 en clon, sin movimiento de fondos';
 page.on('dialog',async d=>d.type()==='prompt'?d.accept(reason):d.accept());
 const nav=label=>menu.getByRole('button',{name:label,exact:true}).click();
 const rpc=async(path,action,method='POST')=>{
  const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/'+path)&&r.request().method()===method);
  await action();
  const res=await response;
  assert.ok(res.ok(),path+' HTTP '+res.status());
 };
 const statement=async()=>checked(await admin.from('owner_statements').select('id,status,gross_income,commission_amount,other_deductions,net_amount').eq('organization_id',org).eq('lease_id',lease.id).eq('period_month',period).maybeSingle());
 const property=checked(await admin.from('leases').select('property_id').eq('organization_id',org).eq('id',lease.id).single()).property_id;
 const deal=checked(await admin.from('deals').select('id').eq('property_id',property).eq('organization_id',org).single());
 const commission=async()=>checked(await admin.from('commissions').select('id,status,amount').eq('organization_id',org).eq('deal_id',deal.id).maybeSingle());

 await nav('Nueva vinculación');
 await page.getByRole('button',{name:/6\s*Cobros/}).click();
 await page.locator('summary').filter({hasText:'Consultar cánones, saldos y estados de cuenta'}).click();
 const amendment=checked(await admin.from('lease_rent_amendments').select('id').eq('lease_id',lease.id));
 if(!amendment.length){
  await page.locator('tr').filter({hasText:contract}).getByRole('button',{name:'Editar canon futuro'}).click();
  const f=page.locator('form').filter({has:page.locator('[name=document_reference]')});
  await f.locator('[name=rent]').fill('1250000');
  await f.locator('[name=document_reference]').fill('QA203-OTROSI-FICTICIO');
  await f.locator('[name=reason]').fill(reason);
  await rpc('rpc/schedule_lease_rent_amendment',()=>f.getByRole('button',{name:'Programar canon'}).click());
  console.log('ADMIN contract amendment via UI PASS');
 }
 assert.equal(checked(await admin.from('lease_rent_amendments').select('id').eq('lease_id',lease.id)).length,1);

 await nav('Comisiones');
 if(!await commission()){
  await page.getByRole('button',{name:'Nueva comisión'}).click();
  const f=page.locator('form').filter({has:page.locator('[name=calculation_basis]')});
  await f.locator('[name=deal_id]').selectOption(deal.id);
  await f.locator('[name=percentage]').fill('10');
  await f.locator('[name=calculation_basis]').fill('100000');
  await f.locator('[name=notes]').fill(reason);
  await rpc('commissions',()=>f.getByRole('button',{name:'Guardar comisión'}).click());
  assert.equal(Number((await commission()).amount),10000);
  console.log('ADMIN commission 10% x 100000 PASS');
 }
 const cr=page.locator('tr').filter({hasText:contract});
 if((await commission()).status==='PENDING'){
  await rpc('rpc/cancel_unpaid_commission',()=>cr.locator('select').selectOption('CANCELLED'));
  assert.equal((await commission()).status,'CANCELLED');
  console.log('ADMIN commission cancellation PASS');
 }
 if((await commission()).status==='CANCELLED'){
  await rpc('rpc/restore_cancelled_commission',()=>cr.getByRole('button',{name:'Recuperar',exact:true}).click());
  assert.equal((await commission()).status,'PENDING');
  console.log('ADMIN commission recovery PASS');
 }

 await nav('Propietarios');
 if(!await statement()){
  const f=page.locator('form').filter({has:page.locator('[name=lease_id]')});
  await f.locator('[name=lease_id]').selectOption(lease.id);
  await f.getByLabel('Mes de liquidación').fill('2026-11');
  await f.getByLabel(/Comisión inmobiliaria/).fill('10');
  await f.getByLabel(/Impuestos \/ retenciones/).fill('0');
  await rpc('rpc/create_owner_draft_statement_by_percentage',()=>f.getByRole('button',{name:'Guardar liquidación en borrador'}).click());
  const s=await statement();
  assert.equal(Number(s.gross_income),234000);
  assert.equal(Number(s.commission_amount),23400);
  console.log('ADMIN owner draft and commission PASS');
 }
 const s=await statement();
 const line=async()=>checked(await admin.from('owner_statement_deductions').select('id,status,amount').eq('organization_id',org).eq('statement_id',s.id).eq('support_reference','QA203-AGUA').maybeSingle());
 if(s.status==='DRAFT'){
  if(!await line()){
   await page.getByRole('button',{name:/Registrar deducción/}).click();
   const f=page.locator('form').filter({has:page.locator('[name=statement_id]')});
   await f.locator('[name=statement_id]').selectOption(s.id);
   await f.locator('[name=category]').selectOption('WATER');
   await f.locator('[name=responsible_party]').selectOption('OWNER');
   await f.locator('[name=amount]').fill('10600');
   await f.locator('[name=support_reference]').fill('QA203-AGUA');
   await f.locator('[name=description]').fill(reason);
   await rpc('owner_statement_deductions',()=>f.getByRole('button',{name:'Guardar deducción en borrador'}).click());
  }
  if((await line()).status==='DRAFT'){
   await rpc('owner_statement_deductions',()=>page.locator('tr').filter({hasText:'QA203-AGUA'}).getByRole('button',{name:'Aprobar',exact:true}).click(),'PATCH');
   assert.equal((await line()).status,'APPROVED');
   console.log('ADMIN owner deduction approval PASS');
  }
  const rec=page.getByText('QA203 Titular ficticio · 2026-11-01',{exact:true}).locator('..');
  await rpc('rpc/reconcile_owner_draft_statement_audited',()=>rec.getByRole('button',{name:'Actualizar conciliación'}).click());
  assert.equal(Number((await statement()).net_amount),200000);
  await rpc('rpc/revert_owner_draft_reconciliation',()=>rec.getByRole('button',{name:'Deshacer última conciliación'}).click());
  assert.equal(Number((await statement()).net_amount),210600);
  await rpc('rpc/reconcile_owner_draft_statement_audited',()=>rec.getByRole('button',{name:'Actualizar conciliación'}).click());
  assert.equal(Number((await statement()).net_amount),200000);
  console.log('ADMIN reconciliation, audited reversal and recomputation PASS');
  await rpc('rpc/admin_issue_owner_statement',()=>page.locator('tr').filter({hasText:'QA203 Titular ficticio'}).getByRole('button',{name:'Confirmar emisión'}).click());
  assert.notEqual((await statement()).status,'DRAFT');
  console.log('ADMIN owner statement issued PASS');
 }
}
