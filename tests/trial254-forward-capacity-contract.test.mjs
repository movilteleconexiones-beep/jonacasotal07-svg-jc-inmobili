import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const draft=read('security/candidates/20261107_trial_lifetime_capacity_forward.NOT_APPLIED.sql');
const runner=read('security/tests/chronological_pg17_capacity_258.sh');

test('#254 requires production v101 before new 8-day/lifetime forward SQL',()=>{
  assert.match(draft,/REJECT: #258 capacity guard v101 must be installed/);
  assert.match(draft,/jco_private\.plan_capacity_fits\(target_org,target_plan\)/);
  assert.match(draft,/jco_private\.plan_capacity_fits\(org\.id,payment\.plan_id\)/);
  assert.match(draft,/jco_private\.plan_capacity_fits\(target_org,target_plan_id\)/);
  assert.match(draft,/plan_capacity_review/);
  assert.match(draft,/postflight/);
});

test('#254 trial is eight days, requires verified owner/terms and is one-time per owner',()=>{
  assert.match(draft,/interval '8 days'/);
  assert.match(draft,/owner_user_id uuid NOT NULL UNIQUE/);
  assert.match(draft,/email_confirmed_at IS NOT NULL/);
  assert.match(draft,/terms_version_id=terms_id/);
  assert.match(draft,/billing\.eight_day_trial_started/);
  assert.match(draft,/REVOKE ALL ON FUNCTION public\.billing_start_eight_day_trial\(uuid,uuid\) FROM PUBLIC,anon,service_role/);
});

test('#254 lifetime is non-expiring only with approved terms and capacity checks',()=>{
  assert.match(draft,/action='GRANT_LIFETIME'/);
  assert.match(draft,/public\.is_platform_admin\(\)/);
  assert.match(draft,/jco_private\.plan_capacity_fits\(target_org,target_plan\)/);
  assert.match(draft,/license_type='LIFETIME',status='ACTIVE'/);
  assert.match(draft,/current_period_end=NULL/);
  assert.match(draft,/accepted_by/);
});

test('#254 stays out of canonical production migrations and replays 104 baseline first',()=>{
  const names=readdirSync(new URL('../supabase/migrations/',import.meta.url));
  assert.equal(names.filter(n=>n.endsWith('.sql')).length,102);
  assert.ok(!names.some(n=>/trial_lifetime_capacity_forward|eight_day_trial_manual_lifetime/.test(n)));
  assert.match(runner,/JCO_STAGE_TRIAL254/);
  assert.match(runner,/PASS: pinned #258 forward migration/);
  assert.match(runner,/capacity\/trial\/ACL regression/);
  assert.match(read('src/core/billing-release-flags.ts'),/VITE_BILLING_TRIAL_LIFETIME_ENABLED === 'true'/);
});
