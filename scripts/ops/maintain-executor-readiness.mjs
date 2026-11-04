// Offline fail-closed readiness audit for the PostgreSQL 17 MAINTAIN fix.
// This verifies the EXECUTOR's privileges, not whether a release is authorized.
// Runs without Supabase credentials; never executes SQL or changes grants.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function assessMaintainExecutor(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw Error('Missing role capability snapshot');
  const required=[
    'executor','executor_superuser','member_of_postgres',
    'member_of_supabase_admin','can_set_supabase_admin','public_tables',
    'anon_maintain','authenticated_maintain','other_owner_tables',
    'default_owner_roles','problematic_default_grants'
  ];
  for(const name of required) if(!(name in snapshot)) throw Error('Missing snapshot field: '+name);
  if(typeof snapshot.executor !== 'string' ||
    !Array.isArray(snapshot.default_owner_roles) ||
    !['executor_superuser','member_of_postgres','member_of_supabase_admin','can_set_supabase_admin']
      .every(k=>typeof snapshot[k]==='boolean') ||
    !['public_tables','anon_maintain','authenticated_maintain','other_owner_tables','problematic_default_grants']
      .every(k=>Number.isSafeInteger(snapshot[k]) && snapshot[k]>=0))
    throw Error('Invalid snapshot role or catalog metadata');
  if(snapshot.anon_maintain>snapshot.public_tables ||
     snapshot.authenticated_maintain>snapshot.public_tables ||
     snapshot.other_owner_tables>snapshot.public_tables)
    throw Error('Inconsistent catalog counts');
  const ownerRoles=[...new Set(snapshot.default_owner_roles)];
  const unreachableOwnerRoles=ownerRoles.filter(role =>
    !snapshot.executor_superuser &&
    !(role===snapshot.executor ||
      (role==='postgres' && snapshot.member_of_postgres) ||
      (role==='supabase_admin' && snapshot.member_of_supabase_admin)));
  const allInOneExecutorQualified=unreachableOwnerRoles.length===0 &&
    (snapshot.executor_superuser ||
      snapshot.executor==='postgres' ||
      snapshot.member_of_postgres) &&
    snapshot.other_owner_tables===0;
  const findings=[];
  if(unreachableOwnerRoles.length)
    findings.push('Cannot alter default privileges for: '+unreachableOwnerRoles.join(', '));
  if(snapshot.other_owner_tables)
    findings.push('Some public tables have a different owner; inspect grants before REVOKE');
  if(snapshot.problematic_default_grants>0)
    findings.push('Default MAINTAIN grants still affect future tables');
  if(snapshot.anon_maintain>0 || snapshot.authenticated_maintain>0)
    findings.push('Effective MAINTAIN grants still affect API roles');
  return {
    examined_public_tables:snapshot.public_tables,
    anon_maintain_tables:snapshot.anon_maintain,
    authenticated_maintain_tables:snapshot.authenticated_maintain,
    problematic_default_grants:snapshot.problematic_default_grants,
    unreachable_default_acl_owners:unreachableOwnerRoles,
    all_in_one_executor_qualified:allInOneExecutorQualified,
    findings,
    staging_verified:false,
    production_change_authorized:false,
    migration_push_authorized:false
  };
}

function main(args) {
  if(args.some(arg=>['--apply','--repair','--push','--revoke'].includes(arg)))
    throw Error('This is a READ-ONLY audit. Refusing mutation argument.');
  const idx=args.indexOf('--snapshot');
  if(idx<0 || !args[idx+1]) throw Error('Usage: node maintain-executor-readiness.mjs --snapshot <catalog.json> [--json]');
  const snapshot=JSON.parse(readFileSync(resolve(args[idx+1]),'utf8'));
  const report=assessMaintainExecutor(snapshot);
  if(args.includes('--json')) console.log(JSON.stringify(report,null,2));
  else {
    console.log('Current executor: '+snapshot.executor);
    console.log('Can run full existing candidate: '+report.all_in_one_executor_qualified);
    for(const finding of report.findings) console.log('BLOCKER: '+finding);
    console.log('NO-GO: staging, migration reconciliation and release approval still required.');
  }
  // Never convert observed ability into approval, even if a superuser ran it.
  return 0;
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  try{process.exitCode=main(process.argv.slice(2));}
  catch(e){console.error(e.message);process.exitCode=2;}
}
