import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/qa/finance96-windows.ps1',import.meta.url),'utf8');

test('#96 Windows launcher refuses any project other than the isolated restoration clone',()=>{
  assert.match(script,/https:\/\/zjgstfgiirgjssnihaam\.supabase\.co/);
  assert.match(script,/\$env:JCO_QA96_SUPABASE_URL -ne \$clone/);
  assert.match(script,/No se permiten URLs de produccion/);
  assert.match(script,/Select-String -LiteralPath \$probe -Pattern 'VALID_REVIEW_NOTE'/);
  assert.match(script,/Test-Path -LiteralPath \$membership/);
  assert.doesNotMatch(script,/https:\/\/cuitgyqrjibgwuniapmk\.supabase\.co/);
});

test('#96 Windows launcher prompts locally and zeroes the secret without printing it',()=>{
  assert.match(script,/Read-Host 'Pegue Secret key qa96_certificacion SOLO del clon' -AsSecureString/);
  assert.match(script,/SecureStringToBSTR\(\$secret\)/);
  assert.match(script,/PtrToStringBSTR\(\$keyPtr\)/);
  assert.match(script,/ZeroFreeBSTR\(\$keyPtr\)/);
  assert.match(script,/StartsWith\('sb_secret_'/);
  assert.match(script,/StartsWith\('sb_publishable_'/);
  assert.doesNotMatch(script,/Write-Host.*\$(?:plain|secret|publishable)/);
  assert.match(script,/Remove-Item "Env:\$name" -ErrorAction SilentlyContinue/);
});

test('#96 launcher invokes real JWT runner only with auto fixtures and reports failure',()=>{
  assert.match(script,/\$env:JCO_QA96_PROVISION = '1'/);
  assert.match(script,/\$env:JCO_QA96_AUTO_FIXTURES = '1'/);
  assert.match(script,/& node \$runner/);
  assert.match(script,/\$exitCode = \$LASTEXITCODE/);
  assert.match(script,/RESULTADO QA96: \$exitCode/);
  assert.match(script,/if \(\$exitCode -ne 0\)/);
  assert.match(script,/foreach \(\$name in @\(/);
  assert.match(script,/finally \{/);
});
