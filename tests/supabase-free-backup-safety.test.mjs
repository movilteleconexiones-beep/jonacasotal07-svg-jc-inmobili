import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const backup=readFileSync(new URL('../scripts/backup-inmojco-free.ps1',import.meta.url),'utf8');

test('Windows script is a local Supabase read-only export guarded by correct project',()=>{
  assert.match(backup,/cuitgyqrjibgwuniapmk/);
  assert.match(backup,/supabase\\.temp\\project-ref/);
  assert.match(backup,/-ConfirmEncryptedDestination/);
  assert.match(backup,/repoRoot/);
  assert.match(backup,/OneDrive/);
  for(const cmd of ['--linked','--role-only','--data-only','--use-copy']) assert.ok(backup.includes(cmd), cmd);
  for(const label of ['roles','schema','data']) assert.ok(backup.includes(`Label='${label}'`), label);
  assert.match(backup,/SHA256SUMS\.txt/);
  assert.match(backup,/AUN NO ES UNA COPIA RECUPERABLE VERIFICADA/);
  assert.doesNotMatch(backup,/\b(drop|alter|truncate|delete|create project|restore_project|db reset|db push|db remote commit)\b/i);
  assert.doesNotMatch(backup,/(?:--db-url|--password|postgres:\/\/|WOMPI_INTEGRITY_SECRET)/);
});

test('remote backup commands do not run except three approved CLI export invocations',()=>{
  const invocations=backup.match(/& supabase /g)||[];
  assert.equal(invocations.length,1,'single parametrized db dump invocation');
  assert.match(backup,/& supabase db dump @argsForDump --file \$file/);
  assert.match(backup,/\$LASTEXITCODE -ne 0/);
  assert.match(backup,/Write-Warning 'La exportacion quedo INCOMPLETA/);
});
