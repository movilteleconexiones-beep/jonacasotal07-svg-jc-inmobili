import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sql = readFileSync(
  new URL('../security/tests/crm_public_lead_rollback_e2e_281.sql', import.meta.url),
  'utf8',
);

test('#281 hosted CRM rehearsal is test-only, anonymous and reversible', () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /SET LOCAL lock_timeout/);
  assert.match(sql, /ba\.is_test/);
  assert.match(sql, /o\.slug='sistema-inmobiliario-jco'/);
  assert.match(sql, /SET LOCAL ROLE anon;/);
  assert.match(sql, /RESET ROLE;[\s\S]*ROLLBACK;/);
  assert.match(sql, /@example\.invalid/);
  assert.match(sql, /qa-policy\.example\.invalid/);
  assert.doesNotMatch(sql, /\bCOMMIT\s*;/i);
  assert.doesNotMatch(sql, /\bservice_role\b/i);
});
test('#281 requires contact reuse, separate events and consent, invalid request rejection', () => {
  for (const name of [
    'submit_public_website_lead_once', 'public.contacts',
    'public.leads', 'private.website_lead_consents',
    'SQLSTATE \'22023\'', 'n_contacts<>1', 'n_leads<>2', 'n_receipts<>2',
  ]) assert.ok(sql.includes(name), name);
});
test('#281 does not claim a real browser, concurrent sessions or final public launch', () => {
  assert.match(sql, /Simulated anonymous SQL role, not a real browser/i);
});
