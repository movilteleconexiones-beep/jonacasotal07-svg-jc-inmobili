import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  HISTORIC_FUNCTION_SOURCES,
  extractDollarQuotedFunctionBody,
  compareHistoricFinanceBodies,
} from '../scripts/ops/finance-function-equivalence-audit.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(readFileSync(join(root,'docs/ops/snapshots/finance-function-catalog-2026-11-02.json'),'utf8'));
const readMigration=file=>readFileSync(join(root,'supabase/migrations',file),'utf8');

test('six sensitive finance functions retain auditable source and live fingerprints',()=>{
  assert.equal(Object.keys(HISTORIC_FUNCTION_SOURCES).length,6);
  const report=compareHistoricFinanceBodies(catalog,readMigration);
  assert.equal(report.count,6);
  assert.equal(report.identical_bodies+report.differing_or_superseded_bodies,6);
  assert.equal(report.identical_bodies,5,'five historic bodies are unchanged in captured live catalog');
  assert.equal(report.verified_later_revisions,1,'rent period was intentionally superseded by amendment support');
  assert.equal(report.unresolved_bodies,0);
  const amended=report.comparisons.find(r=>r.function==='create_tenant_rent_period');
  assert.equal(amended.status,'body-matches-later-revision');
  assert.equal(amended.later_source_file,'20261013010000_safe_future_rent_amendments_and_unpaid_corrections.sql');
  assert.equal(report.full_ddl_equivalence_verified,false);
  assert.equal(report.safe_to_repair_migrations,false);
  assert.equal(report.safe_to_push_migrations,false);
  for (const row of report.comparisons) {
    assert.match(row.historic_body_md5,/^[a-f0-9]{32}$/);
    assert.match(row.captured_live_body_md5,/^[a-f0-9]{32}$/);
    assert.equal(row.anon_can_execute,false);
    if(row.historic_body_md5===row.captured_live_body_md5)
      assert.equal(row.status,'body-identical-in-captured-catalog');
    else if(row.later_body_md5===row.captured_live_body_md5)
      assert.equal(row.status,'body-matches-later-revision');
    else assert.equal(row.status,'body-different-or-unmapped');
  }
});

test('body extraction compares exact PostgreSQL source, including whitespace',()=>{
  const fixture='CREATE FUNCTION public.example() RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\n NULL;\nEND;\n$$;';
  const body=extractDollarQuotedFunctionBody(fixture,'example');
  assert.equal(body,'\nBEGIN\n NULL;\nEND;\n');
  assert.equal(createHash('md5').update(body).digest('hex').length,32);
  assert.notEqual(createHash('md5').update(body).digest('hex'),
    createHash('md5').update(body.trim()).digest('hex'));
});

test('missing or duplicate SQL definitions do not silently qualify as equivalent',()=>{
  assert.throws(()=>extractDollarQuotedFunctionBody('SELECT 1;','missing'),/Expected exactly one/);
  assert.throws(()=>extractDollarQuotedFunctionBody('CREATE FUNCTION public.a() RETURNS void AS $$A$$; CREATE FUNCTION public.a() RETURNS void AS $$B$$;','a'),/Expected exactly one/);
  assert.throws(()=>extractDollarQuotedFunctionBody('CREATE FUNCTION public.a() RETURNS void AS $$no-close','a'),/Unterminated/);
  assert.throws(()=>extractDollarQuotedFunctionBody('','a;DROP TABLE x'),/Unsafe function/);
});

test('catalog change/missing source is fail-closed and cannot mark migrations ready',()=>{
  assert.throws(()=>compareHistoricFinanceBodies({...catalog,functions:catalog.functions.slice(1)},readMigration),/Catalog fingerprint list changed/);
  assert.throws(()=>compareHistoricFinanceBodies({...catalog,functions:catalog.functions.map((r,i)=>i===0?{...r,body_md5:'broken'}:r)},readMigration),/Invalid live body fingerprint/);
  assert.throws(()=>compareHistoricFinanceBodies(catalog,()=>''),/Expected exactly one/);
  const drifted={...catalog,functions:catalog.functions.map((r,i)=>i===0?{...r,body_md5:'00000000000000000000000000000000'}:r)};
  assert.equal(compareHistoricFinanceBodies(drifted,readMigration).unresolved_bodies,1);
});

/*
 * Seven previously unpinned financial/lease trigger functions. These MD5
 * fingerprints came from a READ-ONLY pg_proc.prosrc query on 2026-11-02.
 * The test proves source-body identity with that captured catalog, not that
 * the original migration ran, nor live DDL/ACL/RLS equivalence or GO for push.
 */
const capturedTriggerBodies = [
  ['after_lease_finished_audited','public','20261014061000_audited_rental_end_owner_retirement.sql','de871de2afe839640e235494885f1f7c'],
  ['guard_active_lease_signed_terms','jco_private','20261029081500_active_lease_rectification_with_signed_evidence.sql','80f0f9eb5367e5941ec0c0bd4aa20b2b'],
  ['guard_lease_activation_property_state','public','20261014071000_sync_rented_property_on_lease_activation.sql','1cddddd5a0d4367d30665afed383722d'],
  ['guard_lease_lifecycle_transition','public','20261014061000_audited_rental_end_owner_retirement.sql','c09501ac080fa0d199046b8cb887faca'],
  ['guard_owner_deduction_admin_void','public','20261013190000_owner_deduction_admin_approval.sql','6d065e9f0b38d638427510822f2472b4'],
  ['guard_rental_activation_with_signed_contract','public','20261012180000_guided_rental_intake_admin_approval.sql','b63ad2896de546f71e1c0eb05c90661f'],
  ['mark_property_rented_after_lease_activation','public','20261014071000_sync_rented_property_on_lease_activation.sql','52e782581b23e875fec766e150beb2cd'],
];

function triggerBody(sql,schema,name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema) || !/^[a-z_][a-z0-9_]*$/.test(name))
    throw Error('Unsafe SQL identifier');
  const header=new RegExp('\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+'+schema+'\\.'+name+'\\s*\\(','gi');
  const matches=[...sql.matchAll(header)];
  if(matches.length!==1) throw Error('Expected exactly one trigger function '+schema+'.'+name);
  const rest=sql.slice(matches[0].index+matches[0][0].length);
  const tag=/\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(rest);
  if(!tag) throw Error('Missing dollar quote for '+name);
  const start=tag.index+tag[0].length;
  const end=rest.indexOf(tag[1],start);
  if(end<0) throw Error('Unterminated trigger body '+name);
  return rest.slice(start,end);
}

test('seven lease/finance trigger bodies match captured pg_proc, including later admin approval revision',()=>{
  assert.equal(capturedTriggerBodies.length,7);
  for(const [name,schema,file,expectedMd5] of capturedTriggerBodies){
    const body=triggerBody(readMigration(file),schema,name);
    assert.equal(createHash('md5').update(body,'utf8').digest('hex'),expectedMd5,
      'captured pg_proc body drift: '+schema+'.'+name);
  }
  const oldBody=triggerBody(readMigration('20261013043000_owner_deduction_admin_only_void.sql'),
    'public','guard_owner_deduction_admin_void');
  assert.notEqual(createHash('md5').update(oldBody,'utf8').digest('hex'),
    '6d065e9f0b38d638427510822f2472b4',
    'older VOID-only function must not be mistaken for later APPROVED/VOIDED revision');
  const [name,schema,file,hash]=capturedTriggerBodies[0];
  assert.notEqual(createHash('md5').update(triggerBody(readMigration(file),schema,name)+' -- tampered','utf8').digest('hex'),hash);
});
