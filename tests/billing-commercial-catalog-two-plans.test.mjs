import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../'+path, import.meta.url),'utf8');

test('agency checkout offers exactly Basic and Professional on monthly COP terms',()=>{
  const src=read('src/modules/billing/BillingModule.tsx');
  assert.match(src,/\.eq\('active', true\)\.eq\('billing_cycle', 'MONTHLY'\)\.eq\('currency', 'COP'\)\.in\('code', \['BASIC', 'PRO'\]\)/);
  assert.doesNotMatch(src,/lifetimeAvailable|setLifetimeAvailable|Licencia vitalicia|INMOJCO Vitalicio/);
  assert.match(src,/md:grid-cols-2/);
  assert.match(src,/visiblePlans\.map\(plan/);
  assert.match(src,/!available/);
});

test('legacy and perpetual plans stay in history but cannot be authorized by the SuperAdmin picker',()=>{
  const src=read('src/modules/platform/BillingAdminControls.tsx');
  assert.match(src,/\.eq\('active',true\)\.eq\('billing_cycle','MONTHLY'\)\.eq\('currency','COP'\)\.in\('code',\['BASIC','PRO'\]\)/);
  assert.match(src,/!plans\.some\(item => item\.id === plan\)/);
  // This PR does NOT delete or migrate older accounts or their subscriptions.
  assert.doesNotMatch(src,/\.delete\(|\.update\(/);
});

test('payment history is never displayed for a different selected organization',()=>{
  const src=read('src/modules/billing/BillingModule.tsx');
  assert.match(src,/\.eq\('organization_id', orgId\)/);
  assert.match(src,/const visibleOrders = loadedOrgId === orgId \? orders : \[\]/);
  assert.match(src,/const visiblePlans = loadedOrgId === orgId \? plans : \[\]/);
  assert.match(src,/visibleOrders\.map\(order/);
  assert.match(src,/return \(\) => \{ requestVersion\.current\+\+; \}/);
  assert.match(src,/if \(version !== requestVersion\.current\) return;/);
});

test('stale checkout cannot redirect or purchase a previously selected agency plan',()=>{
  const src=read('src/modules/billing/BillingModule.tsx');
  assert.match(src,/loadedOrgId !== orgId \|\| !plans\.some\(plan => plan\.id === planId\)/);
  const checkout=src.slice(src.indexOf('async function checkout('),src.indexOf('  if (!billing) return null;'));
  assert.ok(checkout.indexOf('if (version !== requestVersion.current) return;')>0);
  assert.ok(checkout.indexOf('if (version !== requestVersion.current) return;')<checkout.indexOf('window.location.assign('));
  assert.match(checkout,/if \(version === requestVersion\.current\)/);
});
