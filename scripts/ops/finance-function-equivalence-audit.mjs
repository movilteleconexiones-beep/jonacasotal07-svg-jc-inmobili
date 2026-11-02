// Offline comparison: literal PL/pgSQL function body in an old SQL file
// versus the md5(pg_proc.prosrc) fingerprint captured READ-ONLY on 2026-11-02.
// A matching function BODY is not proof that a historic migration ran, and
// does not certify function arguments, SECURITY DEFINER, ACL, policies or DDL.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HISTORIC_FUNCTION_SOURCES = Object.freeze({
  create_owner_draft_statement: '20261012130000_rent_receipts_and_owner_drafts.sql',
  create_tenant_rent_period: '20261012130000_rent_receipts_and_owner_drafts.sql',
  guard_owner_statement_deduction_change: '20261012120000_owner_statement_deduction_lines.sql',
  normalize_owner_deduction_audit_fields: '20261012150000_finance_approval_and_audit_timestamp_hardening.sql',
  reconcile_owner_draft_statement: '20261012140000_reconcile_owner_deductions.sql',
  record_tenant_rent_receipt: '20261012130000_rent_receipts_and_owner_drafts.sql',
});

export function extractDollarQuotedFunctionBody(sql, functionName) {
  if (!/^[a-z][a-z0-9_]*$/.test(functionName)) throw Error('Unsafe function identifier');
  const header = new RegExp('\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.' + functionName + '\\s*\\(', 'ig');
  const matches = [...sql.matchAll(header)];
  if (matches.length !== 1) throw Error('Expected exactly one CREATE FUNCTION public.' + functionName + '; found ' + matches.length);
  const remainder = sql.slice(matches[0].index + matches[0][0].length);
  const delimiter = /\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(remainder);
  if (!delimiter) throw Error('Dollar-quoted body missing: ' + functionName);
  const start = delimiter.index + delimiter[0].length;
  const end = remainder.indexOf(delimiter[1], start);
  if (end === -1) throw Error('Unterminated function body: ' + functionName);
  // pg_proc.prosrc stores precisely the contents between dollar-quote markers.
  return remainder.slice(start, end);
}

export function compareHistoricFinanceBodies(snapshot, readSql) {
  if (!snapshot || !Array.isArray(snapshot.functions)) throw Error('Missing live catalog function list');
  const rows = snapshot.functions;
  const expected = Object.keys(HISTORIC_FUNCTION_SOURCES).sort();
  const actual = rows.map(row => row.proname).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw Error('Catalog fingerprint list changed; explicit reviewer update required');
  const comparisons = rows.map(row => {
    if (!/^[a-f0-9]{32}$/.test(row.body_md5 ?? '')) throw Error('Invalid live body fingerprint for ' + row.proname);
    const file = HISTORIC_FUNCTION_SOURCES[row.proname];
    const sql = readSql(file);
    const localBody = extractDollarQuotedFunctionBody(sql, row.proname);
    const localMd5 = createHash('md5').update(localBody,'utf8').digest('hex');
    return {
      function:row.proname, source_file:file, historic_body_md5:localMd5,
      captured_live_body_md5:row.body_md5,
      status:localMd5 === row.body_md5 ? 'body-identical-in-captured-catalog' : 'body-different-or-superseded',
      anon_can_execute:row.anon_can_execute,
      authenticated_can_execute:row.authenticated_can_execute,
      captured_security_definer:row.security_definer,
      captured_function_settings:row.function_settings,
    };
  });
  const equal = comparisons.filter(x=>x.status==='body-identical-in-captured-catalog').length;
  return {
    captured_at:snapshot.captured_at,
    count:comparisons.length, identical_bodies:equal,
    differing_or_superseded_bodies:comparisons.length-equal,
    comparisons,
    full_ddl_equivalence_verified:false,
    safe_to_repair_migrations:false,
    safe_to_push_migrations:false,
  };
}

function main(args) {
  if (args.includes('--push') || args.includes('--repair') || args.includes('--apply'))
    throw Error('Refusing any mutation request');
  const root=resolve('.');
  const catalog=JSON.parse(readFileSync(join(root,'docs/ops/snapshots/finance-function-catalog-2026-11-02.json'),'utf8'));
  const report=compareHistoricFinanceBodies(catalog,file=>readFileSync(join(root,'supabase/migrations',file),'utf8'));
  if (args.includes('--json')) process.stdout.write(JSON.stringify(report,null,2)+'\n');
  else {
    for (const row of report.comparisons)
      console.log(row.status+': '+row.function+' [historic='+row.historic_body_md5+', snapshot='+row.captured_live_body_md5+']');
    console.log('Historical function bodies identical: '+report.identical_bodies+'/'+report.count);
    console.log('NO-GO: function-body equality does not prove DDL/ACL/RLS equivalence or authorize migration repair/db push.');
  }
  return 0; // means offline comparison ran, NOT that a production change is authorized
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.exitCode=main(process.argv.slice(2)); }
  catch(error) { console.error(error.message); process.exitCode=2; }
}
