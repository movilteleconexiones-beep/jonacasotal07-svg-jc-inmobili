import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const snapshots = Object.freeze([
  {
    version: '20261010232928',
    name: 'property_consignment_intake',
    bytes: 1530,
    sha256: 'bc214b1e2916dfc03b6a3b5e473fe95783ec8467b2d066038779b344c461cfe4',
    checks: ['private.property_intake_sites','public.property_consignments',
      'public.get_public_property_intake_site(text)',
      'public.submit_property_consignment(text,uuid,jsonb)',
      'public.review_property_consignment(uuid,text,text)',
      'property_consignments_read','Consignment indexes incomplete',
      'Consignment security incomplete'],
  },
  {
    version: '20261010232930',
    name: 'fix_property_portal_rls_recursion',
    bytes: 630,
    sha256: 'a32ec2b778504318231c2ae7920183eb3be94d7f5b08601e105d78c39d3430ce',
    checks: ['private.can_read_portal_property(uuid,uuid)',
      'properties_select_portal_related','ownerships_select_portal_owner',
      'Portal recursion fix incomplete'],
  },
]);

function readSnapshot(record) {
  const path = `../docs/ops/snapshots/${record.version}_${record.name}.applied-preflight.sql`;
  return readFileSync(new URL(path, import.meta.url));
}

test('both authenticated applied SQL bodies are byte exact and immutable (#104)',()=>{
  for(const record of snapshots) {
    const bytes=readSnapshot(record);
    assert.equal(bytes.length,record.bytes,'Wrong original ledger byte count for '+record.version);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,
      'SQL was altered from applied Supabase migration '+record.version);
    assert.ok(bytes.toString('utf8').startsWith('DO $$ BEGIN\n'));
    assert.ok(bytes.toString('utf8').endsWith("NOTIFY pgrst,'reload schema';"));
  }
});

test('applied entries are preflight checks, not direct CREATE TABLE migrations',()=>{
  const names=new Set();
  for(const record of snapshots){
    const body=readSnapshot(record).toString('utf8');
    assert.ok(!names.has(record.version));
    names.add(record.version);
    for(const fragment of record.checks)assert.ok(body.includes(fragment),
      'Historical guard missing: '+fragment);
    assert.match(body,/RAISE EXCEPTION/);
    assert.match(body,/to_reg(?:class|procedure)/);
    assert.doesNotMatch(body,/\bCREATE\s+TABLE\b/i);
    assert.doesNotMatch(body,/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i);
    assert.doesNotMatch(body,/\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|DROP\s+TABLE)\b/i);
  }
});

test('mutated preflight body never retains its approved historical fingerprint',()=>{
  for(const record of snapshots){
    const bytes=readSnapshot(record);
    for(const changed of [
      Buffer.concat([bytes,Buffer.from('\n')]),
      Buffer.from(bytes.toString('utf8').replace('NOTIFY pgrst','-- NOTIFY pgrst')),
      Buffer.from(bytes.toString('utf8').replace('RAISE EXCEPTION','RAISE NOTICE')),
    ]){
      assert.notEqual(createHash('sha256').update(changed).digest('hex'),record.sha256);
    }
  }
});
