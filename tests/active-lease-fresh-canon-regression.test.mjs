import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/modules/finance/ActiveLeaseCorrection.tsx',import.meta.url),'utf8');
test('active correction checks up-to-date same-organization property rent before confirmation',()=>{
  const start=source.indexOf('async function rectify(');
  const end=source.indexOf('if(!authorized)return null;',start);
  const body=source.slice(start,end);
  const lookup=body.indexOf("supabase.from('properties')");
  const confirm=body.indexOf('window.confirm(');
  const rpc=body.indexOf("supabase.rpc('admin_rectify_active_lease'");
  assert.ok(lookup>0&&confirm>lookup&&rpc>confirm);
  assert.match(body,/\.eq\('organization_id',organizationId\)/);
  assert.match(body,/\.eq\('id',selectedLease\.property_id\)/);
  assert.match(body,/if\(propertyError\|\|!freshProperty\)/);
  assert.match(body,/rentalCanonWarning\(currentMismatch\)/);
});
