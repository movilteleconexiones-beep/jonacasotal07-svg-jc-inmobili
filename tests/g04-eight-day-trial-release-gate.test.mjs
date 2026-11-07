import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20261107124207_optional_eight_day_trial_release_gated.sql', import.meta.url),
  'utf8',
);
const hostedQA = readFileSync(
  new URL('../security/tests/g04_eight_day_trial_reversible_e2e.sql', import.meta.url),
  'utf8',
);
const billingUI = readFileSync(
  new URL('../src/modules/billing/BillingModule.tsx', import.meta.url),
  'utf8',
);

// Taken from the actual Supabase schema_migrations.statements[1], not a local guess.
// A future change requires a NEW forward migration.
const LIVE_SQL_MD5 = 'd2e5323bdc6d86717e9ea49faf552c69';

test('G04: live 8-day trial SQL matches immutable production migration', () => {
  assert.equal(createHash('md5').update(migration).digest('hex'), LIVE_SQL_MD5);
});

test('G04: start-trial RPC is owner-only, billing-release gated and never automatic', () => {
  assert.match(migration, /NOT jco_private\.billing_owner\(target_org\)/);
  assert.match(migration, /production_enabled IS TRUE/);
  assert.match(migration, /account\.is_test OR account\.manual_access_until IS NOT NULL/);
  assert.match(migration, /a\.action='billing\.trial_started'/);
  assert.match(migration, /s\.trial_ends_at IS NOT NULL/);
  assert.match(migration, /AND code IN \('BASIC','PRO'\)/);
  assert.match(migration, /interval '8 days'/);
  assert.match(migration, /'TRIAL','SAAS_MONTHLY'/);
  assert.match(migration, /NOT EXISTS[\s\S]*?license_acceptances/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.billing_start_eight_day_trial\(uuid,uuid\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.billing_start_eight_day_trial\(uuid,uuid\) TO authenticated/);
  assert.doesNotMatch(migration, /\bTRUNCATE\b|\bDROP TABLE\b|GRANT\s+.*TO\s+anon/i);
});

test('G04: a trial only authorizes 8-day bounded SaaS, not lifetime or manual bypass', () => {
  assert.match(migration, /s\.trial_ends_at = s\.current_period_end/);
  assert.match(migration, /s\.current_period_end > now\(\)/);
  assert.match(migration, /l\.ends_at >= s\.trial_ends_at/);
  assert.match(migration, /UPDATE public\.organizations\s+SET status='ACTIVE',plan_id=target_plan/);
  assert.doesNotMatch(migration, /manual_access_until\s*=/i);
  assert.doesNotMatch(migration, /'LIFETIME'\s*,\s*'ACTIVE'\s*,\s*now\(/);
});

test('G04: hostile SQL replay test is self-contained and always rolls back', () => {
  assert.match(hostedQA, /BEGIN;[\s\S]*SET LOCAL statement_timeout/);
  assert.match(hostedQA, /current_user <> 'postgres'/);
  assert.match(hostedQA, /production_enabled=false/);
  assert.match(hostedQA, /'sandbox'/);
  assert.match(hostedQA, /process_verified_payment_event/);
  assert.match(hostedQA, /Expired trial still operational/);
  assert.match(hostedQA, /Owner obtained a second free trial/);
  assert.match(hostedQA, /ROLLBACK;\s*$/);
  assert.doesNotMatch(hostedQA, /\bCOMMIT\s*;/i);
});

test('G04: user-facing trial button is disabled until server opens live checkout', () => {
  assert.match(billingUI, /trialAndLifetimeActionsEnabled && settings\?\.production_enabled === true/);
  assert.match(billingUI, /if \(!trialAndLifetimeActionsEnabled \|\| settings\?\.production_enabled !== true\)/);
  assert.match(billingUI, /\{isTrial &&/);
  assert.match(billingUI, /Probar gratis 8 días/);
  assert.match(billingUI, /checkout\(plan.id\)/);
});
