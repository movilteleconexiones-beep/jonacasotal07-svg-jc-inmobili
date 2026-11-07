import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {chromium} from 'playwright';

const origin='http://127.0.0.1:3000';
const users=[
 {uid:'a1000000-0000-4000-8000-000000000101',email:'g08-admin-a@example.invalid',role:'ADMIN_A',brand:'JCO QA STAGING TENANT A',modules:['Propiedades','Clientes','Agenda','Usuarios','Prospectos / CRM'],hidden:[]},
 {uid:'a1000000-0000-4000-8000-000000000102',email:'g08-coord-a@example.invalid',role:'COORD_A',brand:'JCO QA STAGING TENANT A',modules:['Propiedades','Clientes','Agenda'],hidden:['Usuarios','Comisiones']},
 {uid:'a1000000-0000-4000-8000-000000000103',email:'g08-agent-a@example.invalid',role:'AGENT_A',brand:'JCO QA STAGING TENANT A',modules:['Propiedades','Clientes','Agenda','Prospectos / CRM'],hidden:['Usuarios','Comisiones']},
 {uid:'a1000000-0000-4000-8000-000000000104',email:'g08-client-a@example.invalid',role:'CLIENT_A',brand:'JCO QA STAGING TENANT A',portalOnly:true},
 {uid:'b2000000-0000-4000-8000-000000000201',email:'g08-admin-b@example.invalid',role:'ADMIN_B',brand:'JCO QA STAGING TENANT B',modules:['Propiedades','Clientes','Agenda','Usuarios'],hidden:[]},
];
const md5=x=>createHash('md5').update(x).digest('hex');
test('G08 full browser login: 5 separated authenticated identities/tenants/role menus',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const user of users){
   const context=await browser.newContext({viewport:{width:1440,height:900}});
   const page=await context.newPage();
   const browserErrors=[];
   page.on('pageerror',error=>browserErrors.push(error.name));
   await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:20000});
   const button=page.getByRole('button',{name:'Acceso',exact:true}).first();
   await button.waitFor({state:'visible',timeout:20000});
   await button.click();
   await page.getByRole('textbox',{name:'Correo',exact:true}).fill(user.email);
   const password='G08qa-'+md5(user.uid+'g08-stage-20261107').slice(0,24);
   await page.locator('input[type=password]').fill(password);
   await page.locator('form').getByRole('button',{name:'Iniciar sesión'}).click();
   // Public root is intentionally never replaced by backoffice on login.
   await page.goto(origin+'/app',{waitUntil:'domcontentloaded',timeout:20000});
   if(user.portalOnly){
     await page.getByText('Portal privado',{exact:false}).first().waitFor({state:'visible',timeout:25000});
     const body=(await page.locator('body').innerText()).slice(0,7000);
     assert.ok(body.includes(user.brand),'Client portal must belong to its own agency');
     assert.ok(!body.includes('JCO QA STAGING TENANT B'),'Foreign tenant identity in client UI');
     assert.equal(await page.getByRole('navigation',{name:'Módulos del sistema'}).count(),0,'CLIENT cannot get admin work modules');
   }else{
     const brand=page.getByLabel('Inmobiliaria activa');
     try {
       await brand.waitFor({state:'visible',timeout:13000});
     } catch(error) {
       // Fictitious staging only. No tokens, passwords, identities or keys.
       const visible=(await page.locator('body').innerText()).slice(0,2600);
       const current=page.url().replace(/\\?.*$/,'');
       console.log('STAGING_UI_DIAG role='+user.role+' path='+current+' page='+JSON.stringify(visible));
       console.log('STAGING_UI_ERRORS '+JSON.stringify(browserErrors.slice(0,8)));
       throw error;
     }
     assert.equal((await brand.innerText()).trim(),user.brand);
     const nav=page.getByRole('navigation',{name:'Módulos del sistema'});
     await nav.waitFor({state:'visible'});
     for(const label of user.modules){
       // Secondary controls may be inside collapsed <details>; DOM buttons must still be present.
       assert.equal(await nav.getByRole('button',{name:label,exact:true,includeHidden:true}).count(),1,`${user.role} lacks ${label}`);
     }
     for(const label of user.hidden??[]){
       assert.equal(await nav.getByRole('button',{name:label,exact:true,includeHidden:true}).count(),0,`${user.role} unexpectedly sees ${label}`);
     }
     const body=(await page.locator('body').innerText()).slice(0,10000);
     const foreign=user.role==='ADMIN_B'?'JCO QA STAGING TENANT A':'JCO QA STAGING TENANT B';
     assert.ok(!body.includes(foreign),`${user.role} leaked other organization's identity`);
   }
   assert.deepEqual(browserErrors,[],`Uncaught page errors for ${user.role}`);
   console.log(`PASS G08 browser role ${user.role} with private session and tenant branding`);
   await context.close();
  }
 }finally{await browser.close()}
});
