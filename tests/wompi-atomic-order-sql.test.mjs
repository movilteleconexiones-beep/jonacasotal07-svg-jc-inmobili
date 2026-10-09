import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/migrations/0032_atomic_sandbox_payment_order_draft.sql', import.meta.url), 'utf8');
test('sandbox order RPC is restricted to authenticated and verified tenant permission', () => {
  assert.match(sql, /auth\.uid\(\) IS NULL/);
  assert.match(sql, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(sql, /has_org_permission\(p_organization_id,'billing\.manage'\)/);
  assert.match(sql, /status='ACTIVE' FOR UPDATE/);
  assert.match(sql, /status='ACTIVE'[\s\S]*?FOR SHARE/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC,anon/);
});
test('sandbox order RPC sets trusted amount and blocks production/tax-unconfigured dates', () => {
  assert.match(sql, /v_plan\.price\*100/);
  assert.match(sql, /'WOMPI','sandbox'/);
  assert.match(sql, /DATE '2027-01-01'/);
  assert.match(sql, /billing_cycle IN \('MONTHLY','ANNUAL'\)/);
  assert.match(sql, /\^JCO_\[a-f0-9\]\{32\}\$/);
  assert.doesNotMatch(sql, /p_amount_in_cents/);
});
