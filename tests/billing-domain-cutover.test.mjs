import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const src=readFileSync(new URL('../supabase/functions/billing/index.ts',import.meta.url),'utf8');
const handler=readFileSync(new URL('../supabase/functions/_shared/billing-handler.ts',import.meta.url),'utf8');

test('Wompi checkout fallback anticipates www.inmojco.com after verified cutover',()=>{
  assert.match(src,/appUrl: Deno\.env\.get\('APP_URL'\) \?\? 'https:\/\/www\.inmojco\.com\/'/);
  assert.doesNotMatch(src,/appUrl: .*https:\/\/app\.inmojco\.com/);
  assert.match(src,/['"]https:\/\/www\.inmojco\.com['"]/);
  assert.match(handler,/'redirect-url': new URL\('\/\?billing=return', config\.appUrl\)/);
  assert.match(src,/Deno\.env\.get\('WOMPI_ENV'\) === 'production' \? 'production' : 'sandbox'/);
});
