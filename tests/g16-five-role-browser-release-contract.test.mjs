import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const runner=read('scripts/qa/finance96-run-auth.mjs');
const runtime=read('scripts/qa/finance96-browser-runtime.mjs');
const browser=read('tests/g16-private-five-role-browser-qa.test.mjs');

test('G16 five-role UI is never silently counted as certified without explicit opt-in',()=>{
 assert.match(browser,/JCO_QA96_RUN_BROWSER==='1'/);
 assert.match(browser,/skip:enabled\?false/);
 assert.match(browser,/assert\.equal\(process\.env\.JCO_QA96_PROVISION,'1'/);
 assert.match(browser,/new URL\(requireEnv\('JCO_QA96_SUPABASE_URL'\)\)\.origin,CLONE/);
 assert.match(browser,/new URL\(requireEnv\('JCO_QA96_BROWSER_ORIGIN'\)\)\.origin,LOCAL/);
 assert.match(browser,/for\(const \[role,suffix\] of AGENT_ROLES\)/);
 assert.match(browser,/['"]ORGANIZATION_OWNER['"]/);
 assert.match(browser,/['"]MANAGER['"]/);
 assert.match(browser,/['"]AGENT['"]/);
 assert.match(browser,/['"]CLIENT['"]/);
 assert.match(browser,/acceptDownloads:false/);
 assert.match(browser,/Blocked unexpected network origin/);
 assert.match(browser,/context\.route\('\*\*\/\*'/);
 assert.match(browser,/return route\.abort\('blockedbyclient'\)/);
 assert.match(browser,/u\.origin!==LOCAL && u\.origin!==CLONE/);
 assert.doesNotMatch(browser,/page\.on\('request'/);
 assert.match(browser,/Forbidden mutation/);
});

test('G16 browser enters real sign-in and tests separate operational menus',()=>{
 assert.match(browser,/getByLabel\('Correo'/);
 assert.match(browser,/getByLabel\('Contraseña'/);
 assert.match(browser,/getByRole\('button',\{name:'Iniciar sesión'/);
 assert.match(browser,/getByRole\('navigation',\{name:'Módulos del sistema'\}\)/);
 assert.match(browser,/getByRole\('heading',\{name:.*Portal privado/);
 assert.match(browser,/publicOther/);
 assert.match(browser,/getByRole\('button',\{name:'Nueva vinculación'/);
 assert.match(browser,/assert\.deepEqual\(violations,\[\]/);
});

test('G16 local Vite never receives service-role key, production URLs, payments or bearer tokens',()=>{
 assert.match(runtime,/VITE_SUPABASE_URL:CLONE/);
 assert.match(runtime,/VITE_SUPABASE_PUBLISHABLE_KEY:env\.JCO_QA96_PUBLISHABLE_KEY/);
 assert.match(runtime,/VITE_PUBLIC_CRM_IDEMPOTENT:'false'/);
 assert.match(runtime,/--host','127\.0\.0\.1'/);
 assert.match(runtime,/--strictPort/);
 assert.match(runtime,/publishedJs\.includes\(CLONE\)/);
 assert.match(runtime,/!publishedJs\.includes\('cuitgyqrjibgwuniapmk'\)/);
 assert.match(runtime,/!publishedJs\.includes\(env\.JCO_QA96_SECRET_KEY\)/);
 assert.match(runtime,/assert\.equal\(served,expectedHtml/);
 assert.match(runtime,/JCO_QA96_RUN_BROWSER,'1'/);
 assert.match(runtime,/preview\.kill\('SIGTERM'\)/);
 assert.doesNotMatch(runtime,/VITE_SUPABASE_SERVICE_ROLE|VITE_WOMPI_PROD|VITE_SUPABASE_SECRET_KEY/);
});

test('G16 temporary Auth users are not cleaned until AFTER UI acceptance, even on failure',()=>{
 const start=runner.indexOf('await spawnAcceptance(env);');
 const next=runner.indexOf('await runProtectedQaBrowser(env);',start);
 const end=runner.indexOf('finally {',next);
 const cleanup=runner.indexOf('cleanupQaAccounts(',next);
 assert.ok(start>0&&next>start&&end>next&&cleanup>end);
 assert.match(runner,/if\(process\.env\.JCO_QA96_RUN_BROWSER==='1'\)/);
 assert.match(runner,/cleanupQaReceiptFixtures/);
 assert.match(runner,/cleanupQaAccounts/);
});

test('G16 network allowlist must be installed before submitting any ephemeral Auth credentials',()=>{
 const guard=browser.indexOf("await context.route('**/*'");
 const signIn=browser.indexOf('await signIn(page,email,password);');
 assert.ok(guard>0&&signIn>guard,'Network blocker must run before login');
 assert.match(browser,/route\.abort\('blockedbyclient'\)/);
 assert.match(browser,/return route\.continue\(\)/);
 assert.match(browser,/u\.origin===CLONE/);
});
