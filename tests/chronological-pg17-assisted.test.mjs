import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pure=read('security/tests/chronological_pg17_probe_99.sh');
const bridge=read('security/tests/chronological_pg17_bridge_probe.sh');
const workflow=read('.github/workflows/migration104-replay.yml');

test('#104: pure replay MUST stop at 28 after 27 original bodies; never allow false GO',()=>{
 assert.match(workflow,/20261010232928, after 27 successful original bodies/);
 assert.match(workflow,/Incomplete consignment migration/);
 assert.match(workflow,/test "\$replay_status" -eq 1/);
 assert.doesNotMatch(pure,/BRIDGE:|bridge_file=/);
 assert.match(pure,/PG17 isolated chronological replay PASS/);
});

test('#104: only two pinned local SQL bridges can be injected into ephemeral PG17',()=>{
 const bridges=[...bridge.matchAll(/bridge_file='([^']+)'/g)].map(m=>m[1]);
 assert.deepEqual(bridges,[
   'supabase/migrations/20261010212630_property_consignment_intake.sql',
   'supabase/migrations/20261010214633_fix_property_portal_rls_recursion.sql'
 ]);
 assert.match(bridge,/20261010232928/);
 assert.match(bridge,/20261010232930/);
 assert.match(bridge,/e4b252f022cf76f5ad773060ff86d33c29ef564c/);
 assert.match(bridge,/e6cb9a3923328158a42c86644fb4a591df25eba9/);
 assert.match(bridge,/git hash-object "\$bridge_file"/);
 assert.doesNotMatch(bridge,/20261010222700_commercial_plan_permissions\.sql/);
 assert.match(bridge,/NOT proof of production origin/);
});

test('#104: synthetic version ledger records successful statements ONLY inside disposable database',()=>{
 assert.match(bridge,/GITHUB_ACTIONS/);
 assert.match(bridge,/RUNNER_TEMP/);
 assert.match(bridge,/-h localhost -U postgres/);
 assert.match(bridge,/CREATE DATABASE \$db/);
 assert.match(bridge,/DROP DATABASE IF EXISTS \$db WITH \(FORCE\)/);
 assert.match(bridge,/CREATE SCHEMA supabase_migrations/);
 assert.match(bridge,/INSERT INTO supabase_migrations\.schema_migrations\(version\)/);
 assert.ok(bridge.indexOf('success=$((success+1))') <
   bridge.indexOf('INSERT INTO supabase_migrations.schema_migrations(version)'));
 assert.doesNotMatch(bridge,/SUPABASE_DB_URL|DATABASE_URL|migration repair --|db push --/);
});

test('#104: all 24 production-catalog fingerprints are strict CI assertions after 99/99 assisted SQL',()=>{
 assert.match(bridge,/expected_count=14/);
 assert.match(bridge,/expected_count=10/);
 assert.match(bridge,/consignment_restore_shape_fingerprint\.sql/);
 assert.match(bridge,/unmatched_three_current_live_preflight\.sql/);
 assert.match(bridge,/CATALOG COMPARISON, NOT GO/);
 assert.match(bridge,/grep -v '\|OK\$' "\$output_file"/);
 assert.match(bridge,/FAIL: isolated \$query_kind catalog differs from pinned production reference/);
 assert.match(bridge,/if \[\[ "\$ok" != "\$expected_count" \]\]; then\n[\s\S]*?exit 1/);
 assert.match(bridge,/\[\[ "\$account_count" == "0" \]\]/);
});

test('#325: third Supabase branch dependency must fail before local-only ACL repair',()=>{
 assert.match(bridge,/version" == '20261031032350'/);
 assert.match(bridge,/REVOKE UPDATE ON TABLE public\.organizations FROM service_role/);
 assert.match(bridge,/has_column_privilege\('service_role','public\.organizations','plan_id','UPDATE'\)/);
 assert.match(bridge,/service_update" != 'f'/);
 assert.match(bridge,/canonical migration incorrectly passed without service_role UPDATE/);
 assert.match(bridge,/Trusted billing service lost commercial update access/);
 assert.match(bridge,/GRANT UPDATE ON TABLE public\.organizations TO service_role/);
 assert.match(bridge,/service_update" != 't'/);
 assert.match(bridge,/BRIDGE: verified third missing staging ACL and repaired ONLY disposable PG17/);
 assert.ok(bridge.indexOf('REVOKE UPDATE ON TABLE public.organizations FROM service_role') <
           bridge.indexOf('GRANT UPDATE ON TABLE public.organizations TO service_role'));
 assert.doesNotMatch(bridge,/supabase migration repair|supabase db push|SUPABASE_DB_URL|DATABASE_URL/);
});
