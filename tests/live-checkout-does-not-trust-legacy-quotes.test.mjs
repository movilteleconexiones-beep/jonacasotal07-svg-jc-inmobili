import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('live checkout uses authoritative database plan prices, never historical demo quote', () => {
  const billing = source('src/modules/billing/BillingModule.tsx');
  const entry = source('supabase/functions/billing/index.ts');
  const handler = source('supabase/functions/_shared/billing-handler.ts');
  const sql = source('supabase/migrations/20261021114500_block_incompatible_checkout_contracts.sql');
  const prices = source('supabase/migrations/20261015074000_approved_monthly_prices_preserve_lifetime.sql');
  const demo = source('server/wompi-sandbox-order-quote.ts');

  // Historical sandbox-only helper intentionally contains old demonstration
  // tariffs. They must NEVER become the authority for real checkout.
  assert.match(demo,/quoteJcoSandboxOrder/);
  for(const executable of [billing,entry,handler,sql]) {
    assert.doesNotMatch(executable,/quoteJcoSandboxOrder|JCO_APPROVED_PRICES_COP|getJcoTaxDecision|wompi-sandbox-order-quote/);
  }
  assert.match(billing,/supabase\.from\('plans'\)/);
  assert.match(billing,/supabase\.functions\.invoke\('billing\/checkout'/);
  assert.match(entry,/client\.rpc\('billing_create_order', args\)/);
  assert.match(sql,/SELECT \* INTO plan FROM public\.plans WHERE id=target_plan AND active FOR SHARE/);
  assert.match(sql,/\(plan\.price\*100\)::bigint/);
  assert.match(prices,/WHEN 'BASIC' THEN 129900/);
  assert.match(prices,/WHEN 'PRO' THEN 299900/);
});

test('production billing remains server controlled and the launch code cannot enable live money', () => {
  const entry = source('supabase/functions/billing/index.ts');
  const sql = source('supabase/migrations/20261021114500_block_incompatible_checkout_contracts.sql');
  const billing = source('src/modules/billing/BillingModule.tsx');
  assert.match(entry,/Deno\.env\.get\('WOMPI_ENV'\) === 'production'/);
  assert.match(entry,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(sql,/settings\.production_enabled/);
  assert.match(sql,/account\.is_test/);
  assert.match(billing,/billing\.is_test \? settings\?\.sandbox_enabled : settings\?\.production_enabled/);
});
