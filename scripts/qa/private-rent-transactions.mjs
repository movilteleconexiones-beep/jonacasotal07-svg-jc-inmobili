import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';
import {addTemporaryQaMember} from './finance96-membership.mjs';
import {cleanupQaAccounts} from './finance96-cleanup.mjs';

const clone='https://zjgstfgiirgjssnihaam.supabase.co';
const local='http://127.0.0.1:4173';
assert.equal(process.env.JCO_QA96_SUPABASE_URL,clone);
const admin=createClient(clone,process.env.JCO_QA96_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function checked(result){assert.ifError(result.error && new Error(result.error.code));return result.data;}
const org=checked(await admin.from('organizations').select('id').eq('slug','sistema-inmobiliario-jco').single()).id;
assert.equal(checked(await admin.from('organization_billing_access').select('is_test').eq('organization_id',org).single()).is_test,true);
const contract='QA203-UI-RENT';
const lease=checked(await admin.from('leases').select('id,monthly_rent').eq('organization_id',org).eq('contract_number',contract).single());
assert.equal(Number(lease.monthly_rent),1234000);
const period='2026-11-01';
const getPeriod=async()=>checked(await admin.from('rent_payments').select('id,expected_amount,paid_amount').eq('organization_id',org).eq('lease_id',lease.id).eq('period_month',period).maybeSingle());
const runId=randomUUID(),created=[];
const browser=await chromium.launch();
try{
 const settlementOnly=process.env.JCO_QA203_PHASE==='settlement';
 for(const role of settlementOnly?['ADMIN']:['MANAGER','AGENT','ADMIN']){
  const roleId=checked(await admin.from('roles').select('id').eq('organization_id',org).eq('key',role).eq('active',true).single()).id;
  const email='qa96-'+randomUUID()+'@example.invalid',password=randomBytes(32).toString('base64url');
  const {user}=checked(await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{qa_suite:'finance96',qa_run:runId}}));
  const record={userId:user.id,memberId:null};created.push(record);
  await addTemporaryQaMember({admin,orgId:org,userId:user.id,roleId,record});
  const ctx=await browser.newContext({serviceWorkers:'block'});
  try{
   await ctx.route('**/*',route=>[local,clone].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
   const page=await ctx.newPage();
   await page.goto(local+'/app');
   await page.getByRole('button',{name:'Acceso',exact:true}).click();
   await page.getByLabel('Correo',{exact:true}).fill(email);
   await page.getByLabel('Contraseña',{exact:true}).fill(password);
   await page.getByRole('button',{name:'Iniciar sesión'}).click();
   const menu=page.getByRole('navigation',{name:'Módulos del sistema'});
   await menu.waitFor();
   const rental=menu.getByRole('button',{name:'Nueva vinculación',exact:true});
   if(settlementOnly){
    const {runSettlementJourney}=await import('./private-settlement-journey.mjs');
    await runSettlementJourney({page,menu,admin,org,lease,contract,checked});
    continue;
   }
   if(role!=='ADMIN'){
    await menu.getByRole('button',{name:'Propiedades',exact:true}).waitFor();
    assert.equal(await rental.count(),0,role+' unexpectedly has rental authoring UI');
    console.log(role+' rental authoring restricted PASS');
    continue;
   }
   await rental.click();
   await page.getByRole('button',{name:/6\s*Cobros/}).click();
   await page.getByRole('button',{name:'Crear cobro mensual',exact:true}).click();
   const form=page.locator('form').filter({has:page.locator('select[name=lease_id]')});
   await form.locator('select').selectOption(lease.id);
   await form.locator('input[name=period]').fill(period.slice(0,7));
   if(!await getPeriod()){
    const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/rpc/create_tenant_rent_period'));
    await form.getByRole('button',{name:'Guardar cobro del mes'}).click();
    assert.ok((await response).ok());
   }
   const payment=await getPeriod();
   assert.equal(Number(payment.expected_amount),1234000);
   console.log('ADMIN synthetic period persisted PASS');
   await page.getByRole('button',{name:'Registrar abono',exact:true}).click();
   const receipt=page.locator('form').filter({has:page.locator('select[name=period_id]')});
   await receipt.locator('select[name=period_id]').selectOption(payment.id);
   await receipt.locator('input[name=reference]').fill('QA203-UI-ABONO');
   await receipt.locator('input[name=amount]').fill('1234001');
   await receipt.getByRole('button',{name:'Guardar abono'}).click();
   await page.getByText('Verifica el cobro, el abono y la referencia del soporte.').waitFor();
   assert.equal(Number((await getPeriod()).paid_amount),Number(payment.paid_amount));
   console.log('ADMIN excess payment rejected PASS');
   if(Number(payment.paid_amount)===0){
    await receipt.locator('input[name=amount]').fill('234000');
    const saved=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/rpc/record_tenant_rent_receipt'));
    await receipt.getByRole('button',{name:'Guardar abono'}).click();
    assert.ok((await saved).ok());
   }
   assert.equal(Number((await getPeriod()).paid_amount),234000);
   await page.reload();await rental.click();await page.getByRole('button',{name:/6\s*Cobros/}).click();
   await page.getByRole('button',{name:'Registrar abono',exact:true}).click();
   await receipt.locator('select[name=period_id]').selectOption(payment.id);
   assert.match(await receipt.locator('option:checked').first().innerText(),/saldo 1[.,]000[.,]000 COP/);
   console.log('ADMIN partial receipt and remaining balance after reload PASS');
  }finally{await ctx.close();}
 }
}finally{try{await browser.close();}finally{await cleanupQaAccounts({admin,created,orgId:org,runId});}}
