import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx',import.meta.url),'utf8');
test('payout evidence is private JPG, PNG or PDF with format and size validation',()=>{
 assert.match(ui,/organization-documents/);
 assert.match(ui,/owner-payouts/);
 assert.match(ui,/file.size>5\*1024\*1024/);
 assert.match(ui,/new Uint8Array\(await file.slice\(0,8\).arrayBuffer\(\)\)/);
 assert.match(ui,/accept="\.jpg,\.jpeg,\.png,\.pdf/);
 assert.match(ui,/createSignedUrl\(reference,60\)/);
});
test('upload precedes authorized payout RPC and failed records clean up uploads',()=>{
 assert.ok(ui.indexOf(".upload(path,file")<ui.indexOf("supabase.rpc('admin_record_owner_payout'"));
 assert.match(ui,/p_evidence_reference:path/);
 assert.match(ui,/if\(uploaded\)/);
 assert.match(ui,/remove\(\[path\]\)/);
});