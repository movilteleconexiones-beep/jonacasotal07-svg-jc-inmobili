import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const draft=read('security/drafts/20261105_eight_day_trial_manual_lifetime.NOT_APPLIED.sql');
const fixture=read('security/tests/eight_day_trial_perpetual_fixture.sql');
const assertions=read('security/tests/eight_day_trial_perpetual_assertions.sql');
const billing=read('src/modules/billing/BillingModule.tsx');
const admin=read('src/modules/platform/BillingAdminControls.tsx');
const workflow=read('.github/workflows/ci.yml');

test('eight-day trial requires confirmed owner and keeps every redemption forever',()=>{
  assert.match(draft,/owner_user_id uuid NOT NULL UNIQUE REFERENCES auth\.users\(id\) ON DELETE RESTRICT/);
  assert.match(draft,/organization_id uuid NOT NULL UNIQUE REFERENCES public\.organizations\(id\) ON DELETE RESTRICT/);
  assert.match(draft,/CHECK \(ends_at = started_at \+ interval '8 days'\)/);
  assert.match(draft,/email_confirmed_at IS NOT NULL/);
  assert.match(draft,/AND r\.key='ORGANIZATION_OWNER'/);
  assert.match(draft,/org\.status<>'INACTIVE'/);
  assert.match(draft,/account\.is_test OR NOT account\.requires_payment/);
  assert.match(draft,/EXISTS\(SELECT 1 FROM private\.jco_trial_redemptions/);
  assert.match(draft,/Accept current license terms first/);
  assert.match(draft,/EXISTS\(SELECT 1 FROM public\.payment_orders WHERE organization_id=target_org AND status='APPROVED'\)/);
  assert.match(draft,/REVOKE ALL ON TABLE private\.jco_trial_redemptions FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(draft,/REVOKE ALL ON FUNCTION public\.billing_start_eight_day_trial\(uuid,uuid\) FROM PUBLIC,anon,service_role/);
  assert.match(draft,/INSERT INTO public\.audit_log\(organization_id,actor_user_id/);
  assert.match(draft,/billing\.eight_day_trial_started/);
});

test('verified purchase supersedes trial without adding unused free days',()=>{
  assert.match(draft,/A trial never lengthens a newly purchased paid period/);
  assert.match(draft,/started_at=excluded\.current_period_start,trial_ends_at=NULL/);
  assert.match(draft,/manual_access_until=NULL,updated_at=now\(\)/);
  assert.match(assertions,/paid plan replaces trial now without adding 8 days/);
  assert.match(assertions,/redelivery cannot lengthen paid plan/);
  assert.match(assertions,/direct paid plan starts immediately and never adds 8 trial days/);
  assert.match(assertions,/direct checkout does not create or consume a free trial/);
  assert.match(billing,/activateEightDayTrial/);
  assert.match(billing,/Probar gratis 8 días/);
  assert.match(billing,/termina la prueba y comienza la vigencia comercial/);
  assert.doesNotMatch(billing,/El pago fue exitoso\. Activando automáticamente/);
});

test('SuperAdmin can grant perpetual term, not unlimited seats, with explicit audit',()=>{
  assert.match(draft,/action='GRANT_LIFETIME'/);
  assert.match(draft,/IF NOT public\.is_platform_admin\(\) THEN RAISE EXCEPTION/);
  assert.match(draft,/code='LIFETIME' AND billing_cycle='ONE_TIME'/);
  assert.match(draft,/max_users=25,max_properties=2000/);
  assert.match(draft,/plan\.max_users IS NULL OR plan\.max_properties IS NULL/);
  assert.match(draft,/a\.terms_version_id=terms_id/);
  assert.match(draft,/r\.key='ORGANIZATION_OWNER' AND r\.active/);
  assert.match(draft,/m\.user_id=a\.accepted_by AND m\.status='ACTIVE'/);
  assert.match(draft,/count\(\*\) FROM public\.organization_members[\s\S]*?status='ACTIVE'\) > plan\.max_users/);
  assert.match(draft,/count\(\*\) FROM public\.properties[\s\S]*?organization_id=target_org\) > plan\.max_properties/);
  assert.match(assertions,/old\/non-owner terms accepted/);
  assert.match(assertions,/over-seat perpetual grant accepted/);
  assert.match(assertions,/over-property perpetual grant accepted/);
  assert.match(assertions,/rejected grants do not create lifetime subscriptions/);
  assert.match(draft,/license_type='LIFETIME',status='ACTIVE'/);
  assert.match(draft,/status='LIFETIME',billing_mode='LIFETIME'/);
  assert.match(draft,/ends_at=NULL,updated_at=now\(\)/);
  assert.match(draft,/s\.status='LIFETIME'/);
  assert.match(draft,/l\.ends_at IS NULL/);
  assert.match(draft,/s\.current_period_end IS NULL/);
  assert.match(assertions,/suspension supersedes perpetual duration/);
  assert.match(admin,/Conceder licencia perpetua · sin vencimiento/);
  assert.match(admin,/action==='GRANT_LIFETIME'/);
  assert.match(billing,/Licencia perpetua activa · sin fecha de vencimiento/);
  assert.match(billing,/isLifetime \? 'Licencia perpetua vigente'/);
});

test('lifetime grant is not an unsuspend shortcut and is not repeatable',()=>{
  assert.match(draft,/ALTER TABLE private\.jco_trial_redemptions ENABLE ROW LEVEL SECURITY/);
  assert.match(draft,/status='SUSPENDED'[\s\S]*?Suspended organization requires separate reactivation/);
  assert.match(draft,/license_type='LIFETIME'[\s\S]*?Perpetual license already active/);
  assert.match(assertions,/duplicate lifetime grant accepted/);
  assert.match(assertions,/duplicate grant must not generate a second success audit/);
  assert.match(assertions,/perpetual grant reversed a suspension/);
  assert.match(assertions,/suspended tenant remains blocked after rejected lifetime regrant/);
});

test('no automated DDL or personal data is ever sent to production',()=>{
  assert.match(draft,/DRAFT, NOT APPLIED/);
  assert.match(workflow,/jco_trial_perpetual_draft_test/);
  assert.match(workflow,/security\/drafts\/20261105_eight_day_trial_manual_lifetime\.NOT_APPLIED\.sql/);
  assert.match(workflow,/security\/tests\/eight_day_trial_perpetual_assertions\.sql/);
  assert.match(fixture,/synthetic accounts/i);
  assert.doesNotMatch(fixture,/@gmail\.com|@outlook\.com|inmojco\.com/i);
  assert.doesNotMatch(draft,/\b(?:db push|migration repair)\b/i);
  assert.doesNotMatch(workflow,/supabase db push/);
});
