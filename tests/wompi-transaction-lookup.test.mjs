import assert from 'node:assert/strict';
import test from 'node:test';
import { createWompiTransactionLookup } from '../server/wompi-transaction-lookup.ts';

test('Wompi transaction lookup uses exact HTTPS host and private key only on backend', async () => {
  const calls=[];
  const lookup=createWompiTransactionLookup('prv_test_FAKE_FOR_TEST',async (url, opts)=>{
    calls.push({url,opts}); return {ok:true,json:async()=>({data:{id:'tx-1'}})};
  });
  assert.deepEqual(await lookup('tx-1','sandbox'),{data:{id:'tx-1'}});
  assert.equal(calls[0].url,'https://sandbox.wompi.co/v1/transactions/tx-1');
  assert.equal(calls[0].opts.headers.Authorization,'Bearer prv_test_FAKE_FOR_TEST');
  assert.equal(calls[0].opts.headers.Accept,'application/json');
  assert.ok(calls[0].opts.signal);
});

test('a missing or wrong-environment key fails closed without calling the provider', async()=>{
  let calls=0;
  const fake=async()=>{calls++;return {ok:true,json:async()=>({})}};
  for(const key of ['',undefined,'pub_test_123','prv_prod_123'])
    await assert.rejects(()=>createWompiTransactionLookup(key,fake)('tx-1','sandbox'),/verification unavailable/);
  await assert.rejects(()=>createWompiTransactionLookup('prv_test_FAKE',fake)('tx-1','production'),/verification unavailable/);
  assert.equal(calls,0);
});

test('provider errors and malformed ids never authorize or expose credentials',async()=>{
  let calls=0;
  const lookup=createWompiTransactionLookup('prv_test_FAKE',async()=>{calls++;return {ok:false,status:404};});
  await assert.rejects(()=>lookup('tx-1','sandbox'),/provider lookup unavailable/);
  await assert.rejects(()=>lookup('../bad','sandbox'),/Invalid transaction id/);
  assert.equal(calls,1);
});
