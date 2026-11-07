// INMOJCO #104. Verify structure of a recorded SELECT-only live baseline.
// Never connects to Supabase or authorizes DDL, migration repair or db push.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..',import.meta.url));
const snapshotFile = 'docs/ops/snapshots/unmatched-three-live-baseline-2026-11-06.json';
const expectedConsignment = ['private.property_intake_sites','public.property_consignments']
  .flatMap(identifier => ['ACL','CATALOG_IDENTITY','COLUMNS','CONSTRAINTS','INDEXES','POLICIES','TRIGGERS']
    .map(component => component + '|' + identifier));
const expectedPortal = [
  'COMMERCIAL_CATALOG|annual-plans-unconfigured',
  'COMMERCIAL_PLAN|BASIC',
  'COMMERCIAL_PLAN|ENTERPRISE',
  'COMMERCIAL_PLAN|LIFETIME',
  'COMMERCIAL_PLAN|PRO',
  'MIGRATION_LEDGER|three-unmatched-versions-absent',
  'RLS_FUNCTION|private.can_read_portal_property(uuid,uuid)',
  'RLS_FUNCTION|public.has_portal_property(uuid)',
  'RLS_POLICY|public.properties.properties_select_portal_related',
  'RLS_POLICY|public.property_ownerships.ownerships_select_portal_owner',
];

function validateRows(rows, expected, label, errors) {
  if (!Array.isArray(rows)) {
    errors.push(label + ': not an array of SELECT-only findings');
    return;
  }
  const found = new Set();
  for (const row of rows) {
    const id = row && row.component + '|' + row.identifier;
    if (!row || typeof row.component !== 'string' ||
        typeof row.identifier !== 'string' || !['OK','DRIFT','MISSING'].includes(row.finding)) {
      errors.push(label + ': malformed finding');
      continue;
    }
    if (found.has(id)) errors.push(label + ': duplicate finding ' + id);
    found.add(id);
    if (row.finding !== 'OK') errors.push(label + ': ' + id + ' is ' + row.finding);
  }
  if (rows.length !== expected.length ||
      found.size !== expected.length ||
      expected.some(item => !found.has(item)) ||
      [...found].some(item => !expected.includes(item))) {
    errors.push(label + ': finding list differs from strict live catalog baseline');
  }
}
export function verifyUnmatchedLiveSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object') {
    return {ok:false,safeToPush:false,safeToRepair:false,errors:['Snapshot missing']};
  }
  if (snapshot.safeToPush !== false || snapshot.safeToRepair !== false ||
      snapshot.productionProject !== 'cuitgyqrjibgwuniapmk' ||
      snapshot.capturedDateAmericaBogota !== '2026-11-06' ||
      snapshot.mainCommitAtCapture !== '735edc9c0486cdf223d5e991b123ab915ffdb6f4') {
    errors.push('Unsafe or unrecognized capture metadata');
  }
  if (snapshot.queries?.consignment !== 'security/checks/consignment_restore_shape_fingerprint.sql' ||
      snapshot.queries?.portalAndBilling !== 'security/checks/unmatched_three_current_live_preflight.sql') {
    errors.push('The captured SQL sources differ');
  }
  validateRows(snapshot.consignment,expectedConsignment,'consignment',errors);
  validateRows(snapshot.portalAndBilling,expectedPortal,'portalAndBilling',errors);
  return {
    ok:errors.length===0,safeToPush:false,safeToRepair:false,
    checked:(snapshot.consignment?.length??0)+(snapshot.portalAndBilling?.length??0),
    errors,
    blocker:'Recorded SELECT checks prove current catalog shape, not migration provenance or chronological PG17 replay.'
  };
}
export function verifyPinnedUnmatchedLiveSnapshot() {
  const snapshot=JSON.parse(readFileSync(resolve(root,snapshotFile),'utf8'));
  return verifyUnmatchedLiveSnapshot(snapshot);
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=verifyPinnedUnmatchedLiveSnapshot();
  console.log(JSON.stringify(result,null,2));
  process.exitCode=result.ok?0:1;
}
