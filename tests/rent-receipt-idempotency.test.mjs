import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/modules/finance/TenantRentEntry.tsx',import.meta.url),'utf8');

test('receipt retries reuse their key only for the exact same tenant and payment details',()=>{
  assert.match(source,/const fingerprint=JSON\.stringify\(\[organizationId,id,amount,method,reference\]\)/);
  assert.match(source,/pendingReceiptRequest\.current\?\.fingerprint!==fingerprint/);
  assert.match(source,/pendingReceiptRequest\.current=\{fingerprint,key:crypto\.randomUUID\(\)\}/);
  assert.match(source,/request_key:pendingReceiptRequest\.current\.key/);
  assert.match(source,/pendingReceiptRequest\.current=null/);
  assert.doesNotMatch(source,/pendingReceiptKey/);
});

test('a changed receipt never retains the retry token',()=>{
  const next=(previous,fields)=> {
    const fingerprint=JSON.stringify(fields);
    return previous?.fingerprint===fingerprint ? previous : {fingerprint,key:'new-key'};
  };
  const old={fingerprint:JSON.stringify(['org-a','period-a',100,'CASH','ref-a']),key:'old-key'};
  assert.equal(next(old,['org-a','period-a',100,'CASH','ref-a']).key,'old-key');
  assert.equal(next(old,['org-a','period-a',200,'CASH','ref-a']).key,'new-key');
  assert.equal(next(old,['org-b','period-a',100,'CASH','ref-a']).key,'new-key');
  assert.equal(next(old,['org-a','period-b',100,'CASH','ref-a']).key,'new-key');
  assert.equal(next(old,['org-a','period-a',100,'BANK_TRANSFER','ref-a']).key,'new-key');
  assert.equal(next(old,['org-a','period-a',100,'CASH','ref-b']).key,'new-key');
});
