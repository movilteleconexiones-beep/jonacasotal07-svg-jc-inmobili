import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20261021114500_block_incompatible_checkout_contracts.sql',root),'utf8');
const indexes = readFileSync(new URL('supabase/migrations/20261021152000_index_critical_tenant_relationships.sql',root),'utf8');
const diagnostic = readFileSync(new URL('security/diagnostics/exact_two_migrations_readonly.sql',root),'utf8');

test('read-only preflight pins exact billing migration function body, not a fuzzy text subset', () => {
  const match = migration.match(/\$function\$([\s\S]*?)\$function\$/);
  assert.ok(match,'billing function body must remain extractable from the migration');
  const md5 = createHash('md5').update(match[1]).digest('hex');
  assert.equal(md5,'a43ed490a069300123b9ed6ca23b76c4','re-audit production and source when billing SQL changes');
  assert.match(diagnostic, /md5\(p\.prosrc\)/);
  assert.ok(diagnostic.includes(md5));
  assert.match(diagnostic, /to_regprocedure\('public\.billing_create_order\(uuid,uuid,text,uuid\)'\)/);
});

test('every expected tenant index must be proven by exact ordered keys and B-tree constraints', () => {
  const names = [
    'deals_org_contact_fk_fast_idx',
    'deals_org_property_fk_fast_idx',
    'maintenance_requests_org_fk_fast_idx',
    'portal_links_contact_fk_fast_idx',
    'portal_links_owner_fk_fast_idx',
  ];
  for(const name of names) {
    assert.ok(indexes.includes(name), 'index absent in migration: '+name);
    assert.ok(diagnostic.includes(name), 'index absent in diagnostic: '+name);
  }
  assert.match(diagnostic, /i\.indisvalid AND i\.indisready/);
  assert.match(diagnostic, /am\.amname='btree'/);
  assert.match(diagnostic, /i\.indpred IS NULL/);
  assert.match(diagnostic, /i\.indexprs IS NULL/);
  assert.match(diagnostic, /i\.indnatts=i\.indnkeyatts/);
  assert.match(diagnostic, /e\.keys IS NOT DISTINCT FROM/);
});

test('production diagnostic can never make a schema, history, data or permissions change', () => {
  assert.match(diagnostic, /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/m);
  assert.match(diagnostic, /ROLLBACK;\s*$/);
  const noComments = diagnostic.replace(/^\s*--.*$/gm,'');
  assert.doesNotMatch(noComments,/^\s*(?:CREATE|ALTER|DROP|UPDATE|INSERT|DELETE|TRUNCATE|GRANT|REVOKE|MERGE|CALL|DO)\s/mi);
  assert.match(diagnostic, /SCHEMA_EFFECTS_MATCH_HISTORY_REPAIR_ONLY_AFTER_VERIFIED_RESTORE/);
  assert.match(diagnostic, /STOP_SCHEMA_DRIFT_INVESTIGATE/);
});
