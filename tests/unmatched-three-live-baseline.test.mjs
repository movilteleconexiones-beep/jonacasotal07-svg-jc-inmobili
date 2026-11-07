import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyPinnedUnmatchedLiveSnapshot, verifyUnmatchedLiveSnapshot }
 from '../scripts/ops/unmatched-three-live-baseline-gate.mjs';

const read = name => readFileSync(new URL('../'+name,import.meta.url),'utf8');
const original=JSON.parse(read('docs/ops/snapshots/unmatched-three-live-baseline-2026-11-06.json'));
const copy=()=>structuredClone(original);

test('#104: 14 physical-consignment + 10 portal/catalog findings are complete and still NO-GO',()=>{
 const result=verifyPinnedUnmatchedLiveSnapshot();
 assert.equal(result.ok,true,result.errors.join(', '));
 assert.equal(result.checked,24);
 assert.equal(result.safeToPush,false);
 assert.equal(result.safeToRepair,false);
 assert.match(result.blocker,/not migration provenance/);
});

test('#104: any missing, duplicated, unknown or changed verdict fails closed',()=>{
 const mutations=[
  x=>x.consignment.pop(),
  x=>x.portalAndBilling.pop(),
  x=>x.consignment.push({...x.consignment[0]}),
  x=>x.portalAndBilling.push({...x.portalAndBilling[0]}),
  x=>x.consignment[0].finding='DRIFT',
  x=>x.portalAndBilling[0].finding='MISSING',
  x=>x.portalAndBilling[0].identifier='wrong-tenant',
  x=>x.portalAndBilling[0].component='UNEXPECTED',
  x=>x.queries.portalAndBilling='unsafe.sql',
  x=>x.productionProject='unknown',
  x=>x.safeToPush=true,
  x=>x.safeToRepair=true,
 ];
 for(const mutate of mutations){
  const variant=copy();mutate(variant);
  const r=verifyUnmatchedLiveSnapshot(variant);
  assert.equal(r.ok,false,mutate.toString());
  assert.equal(r.safeToPush,false);
  assert.equal(r.safeToRepair,false);
 }
 assert.equal(verifyUnmatchedLiveSnapshot(null).ok,false);
});

test('#104: query is strictly read-only, checks privileges, live portal definitions and policy hashes',()=>{
 const q=read('security/checks/unmatched_three_current_live_preflight.sql');
 const c=read('security/checks/consignment_restore_shape_fingerprint.sql');
 const executable=q.split('\n').filter(s=>!s.trimStart().startsWith('--')).join('\n');
 for(const forbidden of [
  /^\s*(?:ALTER|CREATE|DROP|DELETE|INSERT|UPDATE|TRUNCATE|GRANT|REVOKE|NOTIFY|DO|CALL)\b/im,
  /\bmigration\s+repair\s+--/i,
  /\bdb\s+push\s+--/i,
  /\bexecute_sql\s*\(/i,
 ]) assert.doesNotMatch(executable,forbidden);
 assert.match(q,/pg_get_functiondef\(p\.oid\)/);
 assert.match(q,/has_function_privilege\('anon',f\.oid,'EXECUTE'\)=false/);
 assert.match(q,/has_function_privilege\('authenticated',f\.oid,'EXECUTE'\)=true/);
 assert.match(q,/p\.polroles=ARRAY\['authenticated'::regrole::oid\]/);
 assert.match(q,/c\.relrowsecurity/);
 assert.match(q,/p\.current_sha=p\.predicate_sha/);
 assert.match(q,/20261010212630.*20261010214633.*20261010222700/s);
 assert.match(c,/relrowsecurity/);
 assert.match(q,/99/);
 assert.match(q,/ORDER BY component,identifier;/);
});

test('#104: current RLS and live commercial prices are explicitly pinned, historical prices are NOT reusable',()=>{
 const q=read('security/checks/unmatched_three_current_live_preflight.sql');
 const old=read('supabase/migrations/20261010222700_commercial_plan_permissions.sql');
 for(const sha of [
  '99043c5260c8396e41f115576b87659646310d4a78057a2b9617a80e001b8609',
  'cff460f7627973317147be83d814527fb7792a03f7d0dabb36ab7fedf4688555',
  '4084df13a16e475663d65546c5d5876fb15676fbd8fa3d4ea0fdc3ce934b5e87',
  'ed79d03c3fe4422ca8c3115417667e2abf29ec24e414760207db8e604e0ad3e0',
 ]) assert.ok(q.includes(sha),'Missing live RLS fingerprint '+sha);
 for(const value of ["('BASIC','MONTHLY',129900::numeric,'COP',5,200,47)",
                     "('PRO','MONTHLY',299900::numeric,'COP',25,2000,47)"])
   assert.ok(q.includes(value),'Missing live price '+value);
 assert.match(old,/price = 104900/);
 assert.match(old,/price = 194900/);
 assert.doesNotMatch(q,/price = 104900|price = 194900/);
 assert.match(q,/annual-plans-unconfigured/);
 assert.match(q,/three-unmatched-versions-absent/);
});
