import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import * as XLSX from 'xlsx';

const clone='https://zjgstfgiirgjssnihaam.supabase.co';
const local='http://127.0.0.1:4173';

test('Private report downloads and agenda persistence',async t=>{
  assert.equal(process.env.JCO_QA96_SUPABASE_URL,clone);
  assert.equal(process.env.JCO_QA96_BROWSER_ORIGIN,local);
  const dir=await mkdtemp(join(tmpdir(),'qa203-'));
  const browser=await chromium.launch();
  try {
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true});
    await context.route('**/*',route=>{
      const origin=new URL(route.request().url()).origin;
      return [clone,local].includes(origin)?route.continue():route.abort();
    });
    const page=await context.newPage();
    await page.goto(local+'/app');
    await page.getByRole('button',{name:'Acceso',exact:true}).click();
    const form=page.locator('form').filter({has:page.locator('input[type=password]')});
    await form.getByLabel('Correo',{exact:true}).fill(process.env.JCO_QA96_OWNER_EMAIL);
    await form.getByLabel('Contraseña',{exact:true}).fill(process.env.JCO_QA96_OWNER_PASSWORD);
    await form.getByRole('button',{name:'Iniciar sesión'}).click();
    const menu=page.getByRole('navigation',{name:'Módulos del sistema'});
    const button=name=>menu.getByRole('button',{name,exact:true});

    await t.test('Downloaded Excel matches October reference period',async()=>{
      await menu.locator('summary').filter({hasText:'Administración y ajustes'}).click();
      await button('Reportes').click();
      await page.getByLabel('Mes del informe').fill('2026-10');
      await page.getByRole('button',{name:/^Cánones: 1$/}).click();
      const downloading=page.waitForEvent('download');
      await page.getByRole('button',{name:/Exportar seleccionado/}).click();
      const file=join(dir,'report.xlsx');
      await (await downloading).saveAs(file);
      const book=XLSX.readFile(file);
      assert.deepEqual(book.SheetNames,['Cánones']);
      const grid=XLSX.utils.sheet_to_json(book.Sheets['Cánones'],{header:1});
      assert.ok(grid.some(row=>row[0]==='Período' && row[1]==='2026-10'));
      assert.ok(grid.some(row=>row[0]==='Inmobiliaria' && String(row[1]).trim().length>0));
      const data=grid.find(row=>row[1]==='2026-10-01');
      assert.ok(data && Number(data[2])===1700000 && Number(data[3])===0 && data[4]==='PENDING');
    });
    await t.test('Printed PDF matches tenant balance and period',async()=>{
      await button('Nueva vinculación').click();
      await page.getByRole('button',{name:/6\s*Cobros/}).click();
      await page.locator('summary').filter({hasText:'Consultar cánones, saldos y estados de cuenta'}).click();
      const popupEvent=page.waitForEvent('popup');
      await page.getByRole('button',{name:'Emitir estado de cuenta',exact:true}).click();
      const popup=await popupEvent;
      await popup.getByRole('heading',{name:'Estado de cuenta del inquilino'}).waitFor();
      const path=join(dir,'account.pdf');
      await popup.pdf({path});
      const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});
      assert.ok(text.includes('2026-10-01') && text.includes('Estado de cuenta del inquilino'));
      assert.match(text,/Saldo pendiente[^\n]*1[.,]700[.,]000/);
      await popup.close();
    });
    await t.test('Create, confirm and cancel a synthetic appointment across reloads',async()=>{
      await button('Agenda').click();
      await page.getByRole('button',{name:'Nueva cita'}).click();
      const marker='QA203-'+randomUUID();
      await page.locator('input[name=location]').fill(marker);
      await page.locator('input[name=starts_at]').fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
      await page.getByRole('button',{name:'Guardar cita'}).click();
      const row=page.locator('article').filter({hasText:marker});
      await row.waitFor();
      for (const status of ['CONFIRMED','CANCELLED']){
        const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/appointments'&&r.request().method()==='PATCH');
        await row.getByRole('combobox').selectOption(status);
        assert.ok((await saved).ok());
        await page.reload();
        await button('Agenda').click();
        await row.waitFor();
        assert.equal(await row.count(),1);
        assert.equal(await row.getByRole('combobox').inputValue(),status);
      }
    });
  } finally {
    await browser.close();
    await rm(dir,{recursive:true,force:true});
  }
});
