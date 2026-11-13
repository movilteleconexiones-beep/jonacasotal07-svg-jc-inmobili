import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source = readFileSync(
  new URL('../scripts/qa/finance96-run-auth.mjs',import.meta.url),'utf8');

test('#96 Auth provisioning is clone-only and explicitly opt-in', () => {
  assert.match(source,/const CLONE_ORIGIN = 'https:\/\/zjgstfgiirgjssnihaam\.supabase\.co'/);
  assert.match(source,/process\.env\.JCO_QA96_PROVISION,'1'/);
  assert.match(source,/JCO_QA96_SECRET_KEY/);
  assert.match(source,/JCO_QA96_PUBLISHABLE_KEY/);
  assert.match(source,/JCO_QA96_PRIVATE_PDF_PATH/);
  assert.match(source,/JCO_QA96_OTHER_PRIVATE_PDF_PATH/);
  assert.match(source,/is_test,true/);
  assert.match(source,/requires_payment,false/);
  assert.doesNotMatch(source,/cuitgyqrjibgwuniapmk/);
  assert.doesNotMatch(source,/\bINSERT\s+INTO\s+auth\.users/i);
});

test('#96 creates exactly five temporary real Auth accounts and always cleans them', () => {
  for(const key of ['ORGANIZATION_OWNER','ADMIN','MANAGER','AGENT','CLIENT']){
    assert.ok(source.includes("'"+key+"'"),key+' missing');
  }
  assert.match(source,/randomBytes\(32\)/);
  assert.match(source,/auth\.admin\.createUser/);
  assert.match(source,/email_confirm:true/);
  assert.match(source,/qa_suite:'finance96'/);
  assert.match(source,/\.from\('organization_members'\)/);
  assert.match(source,/\.from\('member_roles'\)/);
  assert.match(source,/\.insert\(\{organization_member_id:member\.id,role_id:byRole\.get\(role\)\}\)/);
  assert.match(source,/assert\.equal\(created\.length,5/);
  assert.match(source,/await spawnAcceptance\(env\)/);
  assert.match(source,/finally \{\s*try \{await cleanup\(admin,created,own\.id\)/);
  assert.match(source,/auth\.admin\.deleteUser\(item\.userId\)/);
  assert.match(source,/scope/); // QA scope is documented by code comments.
});

test('#96 does not publish secrets or depend on real payment credentials', () => {
  assert.doesNotMatch(source,/console\.log\([^\n]*(password|email|SECRET_KEY|publicKey|access_token)/i);
  assert.doesNotMatch(source,/WOMPI_|billing_(create|activate)|production_enabled/);
  assert.match(source,/stdio:'inherit',shell:false/);
  assert.match(source,/onlyTestTenants\(checked/);
  assert.match(source,/checked\(supports,supportError/);
  assert.match(source,/await assertPdf\(admin,ownPath,own\.id\)/);
  assert.match(source,/await assertPdf\(admin,foreignPath,foreign\.id\)/);
});
