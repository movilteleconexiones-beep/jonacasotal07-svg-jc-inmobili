import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {inspectPublicRpcBodies,PUBLIC_RPC_SOURCES} from '../scripts/ops/public-rpc-source-audit.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=join(root,'docs/ops/snapshots/public-rpc-catalog-2026-11-02.json');
const snapshot=JSON.parse(readFileSync(file,'utf8'));
const read=filename=>readFileSync(join(root,'supabase/migrations',filename),'utf8');

test('four intentionally anonymous RPCs match the latest committed SQL function bodies and safety controls',()=>{
  const result=inspectPublicRpcBodies(snapshot,read);
  assert.equal(result.reviewed_count,4);
  assert.equal(result.identical_body_count,4,'unexpected DB/source drift requires mapping, not an exception');
  assert.equal(result.result_ok,true,JSON.stringify(result.rows.filter(x=>!x.source_matches_snapshot||!x.expected_controls_present)));
  assert.equal(result.verified_live_auth_rls_end_to_end,false);
  assert.equal(result.permission_revoke_authorized,false);
  assert.equal(result.safe_to_publish,false);
  for(const row of result.rows){
    assert.equal(row.expected_anonymous_api,true);
    assert.equal(row.search_path_is_empty,true);
    assert.equal(row.expected_controls_present,true);
    assert.deepEqual(row.missing_control_patterns,[]);
  }
});

test('refuse changed privileges, search_path or fingerprint without claiming production is safe',()=>{
  const grants={...snapshot,rpcs:snapshot.rpcs.map((x,i)=>i===0?{...x,anon_execute:false}:x)};
  assert.equal(inspectPublicRpcBodies(grants,read).result_ok,false);
  const path={...snapshot,rpcs:snapshot.rpcs.map((x,i)=>i===0?{...x,settings:'search_path=public'}:x)};
  assert.equal(inspectPublicRpcBodies(path,read).result_ok,false);
  const modified={...snapshot,rpcs:snapshot.rpcs.map((x,i)=>i===0?{...x,body_md5:'00000000000000000000000000000000'}:x)};
  assert.equal(inspectPublicRpcBodies(modified,read).identical_body_count,3);
});

test('tenant and consent guards are required in versioned SQL, not merely in catalog metadata',()=>{
  const removed=(name)=>{
    const sql=read(name);
    if(name===PUBLIC_RPC_SOURCES.submit_public_website_lead){
      return sql.replace(/p_consent\s+IS\s+DISTINCT\s+FROM\s+true/i,'true IS DISTINCT FROM true');
    }
    return sql;
  };
  const result=inspectPublicRpcBodies(snapshot,removed);
  const lead=result.rows.find(x=>x.rpc==='submit_public_website_lead');
  assert.equal(lead.expected_controls_present,false);
  assert.equal(result.result_ok,false);
});

test('inventory and invalid fingerprints fail closed',()=>{
  assert.throws(()=>inspectPublicRpcBodies({...snapshot,rpcs:snapshot.rpcs.slice(1)},read),/Unexpected anonymous RPC inventory/);
  const broken={...snapshot,rpcs:snapshot.rpcs.map((r,i)=>i===0?{...r,body_md5:'no'}:r)};
  assert.throws(()=>inspectPublicRpcBodies(broken,read),/Invalid body fingerprint/);
});

test('CLI cannot deploy or revoke privileges',()=>{
  const script=join(root,'scripts/ops/public-rpc-source-audit.mjs');
  const good=spawnSync(process.execPath,[script,'--snapshot',file],{cwd:root,encoding:'utf8'});
  assert.equal(good.status,0,good.stderr+good.stdout);
  assert.match(good.stdout,/NO-GO/);
  for(const verb of ['--apply','--deploy','--repair','--revoke']){
    const bad=spawnSync(process.execPath,[script,'--snapshot',file,verb],{cwd:root,encoding:'utf8'});
    assert.equal(bad.status,2);
    assert.match(bad.stderr,/read-only/);
  }
});

test('all four public RPCs fail the control audit when their tenant isolation guard disappears',()=>{
  for(const rpc of Object.keys(PUBLIC_RPC_SOURCES)){
    const target=PUBLIC_RPC_SOURCES[rpc];
    const modified=filename=>{
      const sql=read(filename);
      if(filename!==target)return sql;
      // The source uses SQL, not a regex: remove the literal tenant guard.
      const actual=/jco_private\.operational_access\s*\(\s*o\.id\s*\)/i;
      assert.match(sql,actual,'fixture must contain tenant guard for '+rpc);
      return sql.replace(/jco_private\.operational_access\s*\(\s*o\.id\s*\)/gi,'true');
    };
    const result=inspectPublicRpcBodies(snapshot,modified);
    const row=result.rows.find(x=>x.rpc===rpc);
    assert.equal(row.expected_controls_present,false,rpc);
    assert.equal(row.source_matches_snapshot,false,rpc);
    assert.equal(result.result_ok,false,rpc);
    assert.match(row.missing_control_patterns.join(' '),/operational_access/,rpc);
  }
});
