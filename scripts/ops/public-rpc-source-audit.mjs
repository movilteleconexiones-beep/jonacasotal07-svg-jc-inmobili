// INMOJCO offline public SECURITY DEFINER audit.
// Correlates literal SQL function bodies with READ-ONLY pg_proc fingerprints.
// This is an integrity check, not a live E2E authentication or security proof.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractDollarQuotedFunctionBody} from './finance-function-equivalence-audit.mjs';

export const PUBLIC_RPC_SOURCES=Object.freeze({
  get_public_property_intake_site:'20261021033500_gate_public_consignment_operational_access.sql',
  submit_property_consignment:'20261021033500_gate_public_consignment_operational_access.sql',
  submit_public_website_lead:'20261021041500_public_website_contact_consent_receipts.sql',
  tenant_public_catalog:'20261020070000_editable_public_portal_sections.sql',
});
const requiredControls=Object.freeze({
  get_public_property_intake_site:[
    /o\.status\s*=\s*'ACTIVE'/i,/s\.enabled\b/i,
    /jco_private\.operational_access\s*\(\s*o\.id\s*\)/i,
  ],
  submit_property_consignment:[
    /contact_consent_required/i,/p_request_id\s+is\s+null/i,
    /octet_length\s*\(\s*p_payload::text\s*\)\s*>\s*12000/i,
    /pg_advisory_xact_lock/i,/consignment_request_conflict/i,
    /v_site\.hourly_limit/i,/v_site\.daily_limit/i,
    /jco_private\.operational_access\s*\(\s*o\.id\s*\)/i,
  ],
  submit_public_website_lead:[
    /p_consent\s+IS\s+DISTINCT\s+FROM\s+true/i,
    /privacyPolicyUrl/i,/pg_advisory_xact_lock/i,
    /private\.website_contact_consents/i,
    /o\.status\s*=\s*'ACTIVE'/i,
    /jco_private\.operational_access\s*\(\s*o\.id\s*\)/i,
  ],
  tenant_public_catalog:[
    /\bstatus\s*=\s*'AVAILABLE'/i,
    /organization_id\s*=\s*o\.id/i,
    /LIMIT\s+100/i,
    /o\.status\s*=\s*'ACTIVE'/i,
    /jco_private\.operational_access\s*\(\s*o\.id\s*\)/i,
  ]
});

export function inspectPublicRpcBodies(snapshot,readMigration){
  if(!snapshot || !Array.isArray(snapshot.rpcs)) throw Error('Missing RPC snapshot');
  const expected=Object.keys(PUBLIC_RPC_SOURCES).sort();
  const names=snapshot.rpcs.map(r=>r.name).sort();
  if(JSON.stringify(expected)!==JSON.stringify(names)) throw Error('Unexpected anonymous RPC inventory');
  const rows=snapshot.rpcs.map(r=>{
    if(!/^[a-f0-9]{32}$/.test(r.body_md5??'')) throw Error('Invalid body fingerprint: '+r.name);
    const source=PUBLIC_RPC_SOURCES[r.name];
    const sql=readMigration(source);
    const body=extractDollarQuotedFunctionBody(sql,r.name);
    const sourceHash=createHash('md5').update(body,'utf8').digest('hex');
    const missing=(requiredControls[r.name]??[]).filter(re=>!re.test(body)).map(re=>re.source);
    const settings=String(r.settings??'');
    const emptySearchPath=settings.split(';').some(v=>v==='search_path=""');
    const intendedPublicAccess=r.security_definer===true && r.anon_execute===true && r.authenticated_execute===true;
    return {
      rpc:r.name,source_file:source,
      source_md5:sourceHash,live_body_md5:r.body_md5,
      source_matches_snapshot:sourceHash===r.body_md5,
      expected_anonymous_api:intendedPublicAccess,
      search_path_is_empty:emptySearchPath,
      expected_controls_present:missing.length===0,
      missing_control_patterns:missing,
      source_is_static_review_only:true,
    };
  });
  return {
    reviewed_count:rows.length,
    identical_body_count:rows.filter(r=>r.source_matches_snapshot).length,
    result_ok:rows.every(r=>r.source_matches_snapshot && r.expected_anonymous_api && r.search_path_is_empty && r.expected_controls_present),
    rows,
    current_database_checked:false,
    verified_live_auth_rls_end_to_end:false,
    permission_revoke_authorized:false,
    safe_to_publish:false
  };
}

function main(args){
  if(args.some(v=>['--apply','--deploy','--repair','--revoke'].includes(v)))
    throw Error('Audit is read-only; DDL and API permission changes are forbidden');
  const ix=args.indexOf('--snapshot');
  if(ix<0||!args[ix+1])throw Error('Usage: node public-rpc-source-audit.mjs --snapshot <catalog.json> [--json]');
  const catalog=JSON.parse(readFileSync(resolve(args[ix+1]),'utf8'));
  const base=resolve('supabase/migrations');
  const report=inspectPublicRpcBodies(catalog,filename=>readFileSync(join(base,filename),'utf8'));
  if(args.includes('--json'))console.log(JSON.stringify(report,null,2));
  else {
    for(const row of report.rows)console.log((row.source_matches_snapshot?'IDENTICAL':'DIFFERENT')+': '+row.rpc+' | controls '+(row.expected_controls_present?'present':'missing'));
    console.log('NO-GO: body hashes do not replace public API Auth/RLS/abuse E2E tests.');
  }
  return report.result_ok?0:2;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{process.exitCode=main(process.argv.slice(2));}
  catch(e){console.error(e.message);process.exitCode=2;}
}
