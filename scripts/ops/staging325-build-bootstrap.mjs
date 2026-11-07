#!/usr/bin/env node
/**
 * #325: Build an isolated 106-step SQL bootstrap candidate from 99 authentic
 * production migration bodies + 3 staging-only historical prerequisites and
 * 4 separately applied forwards: CRM (100th), capacity (101st), lifetime (102nd), MAINTAIN ACL (103rd).
 *
 * NEVER writes to supabase/migrations, talks to Supabase, or updates production.
 * An isolated PG17/Supabase preview MUST still validate this candidate before
 * considering any change to the production migration ledger.
 */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPinnedHistoricalArchive } from './reconstruct-applied-99.mjs';
import { inspectCutover } from './migration104-cutover-gate.mjs';
import { gitBlobSha } from './finance-migration-gate.mjs';

const ROOT = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
const PREFIX = 'docs/ops/archive/legacy-sql-20261107/';
const candidates = Object.freeze([
  {
    version: '20261010232920',
    name: 'staging_restore_consignment_prerequisite',
    legacyFile: '20261010212630_property_consignment_intake.sql',
    sha: 'e4b252f022cf76f5ad773060ff86d33c29ef564c',
    before: '20261010232928',
  },
  {
    version: '20261010232929',
    name: 'staging_restore_portal_prerequisite',
    legacyFile: '20261010214633_fix_property_portal_rls_recursion.sql',
    sha: 'e6cb9a3923328158a42c86644fb4a591df25eba9',
    before: '20261010232930',
  },
  {
    version: '20261031032349',
    name: 'staging_restore_trusted_billing_service_acl',
    before: '20261031032350',
    sql: `-- #325: Branch-only prerequisite. Never run in production.
-- Branches do not inherit production's default public schema privileges.
BEGIN;
DO $check$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'Missing organizations before staging ACL prerequisite';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid='public.organizations'::regclass) THEN
    RAISE EXCEPTION 'Organizations RLS must remain enabled';
  END IF;
END
$check$;
GRANT UPDATE ON TABLE public.organizations TO service_role;
COMMIT;
`,
  },
]);

function pinnedLegacySql(item) {
  if (!/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(item.legacyFile ?? ''))
    throw Error('Invalid pinned staging prerequisite filename');
  const source = realpathSync(resolve(ROOT, PREFIX, item.legacyFile));
  const inside = relative(ROOT, source);
  if (!inside || inside === '..' || inside.startsWith('..' + sep))
    throw Error('Prerequisite source escapes repository');
  const sql = readFileSync(source,'utf8');
  if (gitBlobSha(sql) !== item.sha) throw Error('Archived prerequisite SQL hash drift');
  return sql;
}

export function buildCandidate325() {
  const cutover = inspectCutover();
  if (!cutover.ok || cutover.canonicalCount !== 103 || cutover.archivedSources !== 109)
    throw Error('Canonical 99 + 4 verified forward SQL or archived 109 SQL inventory changed');
  const historic = buildPinnedHistoricalArchive();
  if (!historic.ok || historic.count !== 99 || historic.bytes !== 493999 ||
      historic.safeToReplay !== false || historic.safeToPush !== false)
    throw Error('Unpinned original 99-version ledger');
  const original = historic.bodies.map(x => ({
    version:x.version, name:x.name, sql:x.sql, kind:'CANONICAL',
    sha:x.sha, bytes:x.bytes,
  }));
  const staging = candidates.map(c => {
    const sql = c.legacyFile ? pinnedLegacySql(c) : c.sql;
    if (!/^[0-9]{14}$/.test(c.version) || !sql || c.name.includes('commercial_plan_permissions'))
      throw Error('Invalid staging-only prerequisite');
    return {version:c.version,name:c.name,sql,kind:'STAGING_ONLY',
      sha:gitBlobSha(sql),bytes:Buffer.byteLength(sql,'utf8'),before:c.before};
  });
  // Production versions 100-103 are separately pinned, NEVER rebasing the original 99.
  const forwards = [
    {version:'20261107072304',name:'website_lead_reuse_event_consent',
      sha:'c9fdfccf55c2fd8d70da709dd50d1d56de3361d5'},
    {version:'20261107082410',name:'guard_plan_capacity_verified_review',
      sha:'258d3cba1a361ffd1b9b15be8d9b7828531d2f35'},
    {version:'20261107103505',name:'manual_lifetime_owner_only',
      sha:'feaffad1398f38cea024ba173828cf8af8a18bb5'},
    {version:'20261107115138',name:'revoke_excess_public_maintain_postgres_phase',
      sha:'951f76a05d7b3466e67ed6a90a87fd38e40ba6b9'},
  ].map(row=>{
    const file=realpathSync(resolve(ROOT,'supabase/migrations/'+row.version+'_'+row.name+'.sql'));
    const relativeFile=relative(ROOT,file);
    if(!relativeFile || relativeFile==='..' || relativeFile.startsWith('..'+sep))
      throw Error('Forward migration escapes repository');
    const sql=readFileSync(file,'utf8');
    if(gitBlobSha(sql)!==row.sha)throw Error('Applied forward SQL hash drift: '+row.version);
    return {...row,sql,kind:'FORWARD_APPLIED',bytes:Buffer.byteLength(sql,'utf8')};
  });
  const all = [...original,...staging,...forwards].sort((a,b) => a.version.localeCompare(b.version));
  const ids = new Set(all.map(x=>x.version));
  if (all.length !== 106 || ids.size !== 106 ||
      original.some((x,i)=>x.version !== historic.bodies[i].version))
    throw Error('Candidate 104 does not preserve original 99 migration identities');
  for (const candidate of staging) {
    const index = all.findIndex(x=>x.version===candidate.version);
    const expected = all[index+1];
    if (expected?.version !== candidate.before)
      throw Error('Staging prerequisite not directly before historical guard: '+candidate.version);
  }
  if (all.some(x=>x.version==='20261010222700' || /commercial_plan_permissions/.test(x.name)))
    throw Error('Obsolete commercial price/permission draft must never execute');
  return {ok:true,safeForProduction:false,productionLedgerUntouched:true,
    authenticOriginals:99,forwardApplied:4,stagingOnly:3,total:106,all};
}

export function writeDisposableCandidate325(bundle) {
  if (!bundle?.ok || bundle.safeForProduction !== false ||
      bundle.authenticOriginals !== 99 || bundle.forwardApplied !== 4 ||
      bundle.stagingOnly !== 3 || bundle.total !== 106 || bundle.all.length !== 106)
    throw Error('Unreviewed staging bootstrap candidate');
  const dir = mkdtempSync(join(tmpdir(),'inmojco-staging325-NO-PROD-'));
  const migrations = join(dir,'supabase','migrations');
  mkdirSync(migrations,{recursive:true,mode:0o700});
  const files = [];
  for (const m of bundle.all) {
    if (!/^[0-9]{14}$/.test(m.version) || !/^[a-z0-9_]+$/.test(m.name) ||
        gitBlobSha(m.sql)!==m.sha || Buffer.byteLength(m.sql,'utf8')!==m.bytes)
      throw Error('Bootstrap candidate content validation failed');
    const name = m.version+'_'+m.name+'.sql';
    writeFileSync(join(migrations,name),m.sql,{flag:'wx',mode:0o600});
    files.push({version:m.version,name,kind:m.kind,sha:m.sha,bytes:m.bytes});
  }
  writeFileSync(join(dir,'STAGING-ONLY-MANIFEST.json'),
    JSON.stringify({safeForProduction:false,doNotMergeWithProduction:true,
      originalVersions:99,forwardApplied:4,stagingPrerequisites:3,total:106,files},null,2)+'\n',
    {flag:'wx',mode:0o600});
  return {dir,files:106,safeForProduction:false};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if (args.length>1 || (args.length===1 && args[0]!=='--temporary-staging-only'))
    throw Error('Usage: node scripts/ops/staging325-build-bootstrap.mjs [--temporary-staging-only]');
  const candidate=buildCandidate325();
  const result=args.length?writeDisposableCandidate325(candidate):null;
  console.log(JSON.stringify({ok:true,canonical:99,forwardApplied:4,stagingOnly:3,
    total:106,safeForProduction:false,
    temporaryDirectory:result?.dir??null},null,2));
}
