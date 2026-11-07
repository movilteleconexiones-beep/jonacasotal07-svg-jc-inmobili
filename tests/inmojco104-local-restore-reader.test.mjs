import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('../scripts/ops/inmojco104-verify-existing-restore.ps1',import.meta.url),'utf8');

test('#104 existing PG17 restore identifies localhost explicitly without assuming Docker internal port',()=>{
  assert.match(source,/\$HostName\s*=\s*'127\.0\.0\.1'/);
  assert.match(source,/\$Port\s*=\s*'5433'/);
  assert.match(source,/\$Db\s*=\s*'inmojco_restore_test_3'/);
  assert.doesNotMatch(source,/inet_server_addr\(\)/);
  assert.doesNotMatch(source,/inet_server_port\(\)/);
  assert.match(source,/current_setting\('server_version_num'\)/);
  assert.match(source,/current_setting\('transaction_read_only'\)/);
});

test('#104 a missing managed schema_migrations table is detected without querying absent relation',()=>{
  const presence=source.indexOf("to_regclass('supabase_migrations.schema_migrations')");
  const query=source.indexOf("FROM supabase_migrations.schema_migrations ORDER BY version");
  assert.ok(presence>0 && query>presence,'presence query must precede ledger SELECT');
  assert.match(source,/if \(\$ledgerPresent\) \{\s*\$actual/);
  assert.match(source,/ledgerComparison=\$\(if\(!\$ledgerPresent\)\{'UNAVAILABLE_LOCAL'\}/);
  assert.match(source,/structureMatchesPreviouslyDocumentedRestore=/);
  assert.match(source,/safeToRunDbPush=\$false; safeToRepairMigrations=\$false/);
});

test('#104 checker never repairs history, mutates DB, extracts documents or logs private rows',()=>{
  assert.match(source,/default_transaction_read_only=on/);
  assert.match(source,/\$env:PGOPTIONS/);
  assert.doesNotMatch(source,/\b(?:pg_restore|pg_dump|supabase migration repair|supabase db push)\b/i);
  assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE|CREATE TABLE|DROP TABLE|TRUNCATE)\b/i);
  assert.doesNotMatch(source,/SELECT[^\n]+(?:email|phone|password|storage\.objects\.name)/i);
});
