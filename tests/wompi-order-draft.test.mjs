import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSandboxOrderDraft } from '../server/wompi-order-draft.ts';

const org='22222222-2222-4222-8222-222222222222';

test('creates unpredictable unique references with trusted COP amount',()=>{
 const input={organizationId:org,planCode:'BASIC_ANNUAL',colombiaDate:'2026-10-08'};
 const a=buildSandboxOrderDraft(input),b=buildSandboxOrderDraft(input);
 assert.equal(a.amountInCents,103900000);
 assert.equal(a.currency,'COP');
 assert.equal(a.environment,'sandbox');
 assert.equal(a.billingMode,'SAAS_ANNUAL');
 assert.match(a.reference,/^JCO_[a-f0-9]{32}$/);
 assert.notEqual(a.reference,b.reference);
});

test('rejects malformed organization, lifetime, unconfigured future tax',()=>{
 assert.throws(()=>buildSandboxOrderDraft({organizationId:'bad',planCode:'BASIC',colombiaDate:'2026-10-08'}));
 assert.throws(()=>buildSandboxOrderDraft({organizationId:org,planCode:'LIFETIME',colombiaDate:'2026-10-08'}));
 assert.throws(()=>buildSandboxOrderDraft({organizationId:org,planCode:'BASIC',colombiaDate:'2027-01-01'}));
});
