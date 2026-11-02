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
