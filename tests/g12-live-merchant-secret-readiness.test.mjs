import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * G12 verified merchant readiness.
 * Send ONLY a deliberately invalid Wompi webhook.
 * The LIVE function returns 503 if one/more merchant secrets are absent.
 * It returns 401 for an invalid signature if ALL four keys have correct prod prefixes.
 * No tokens, real orders, card data, personal info, or secrets are ever used or printed.
 * 401 proves the Edge runtime received plausible keys; it does NOT verify merchant
 * activation, registration of Wompi callback URL, or ability to settle a card payment.
 */
test('G12 production gateway must receive all four Wompi LIVE secrets',async()=>{
  const url='https://cuitgyqrjibgwuniapmk.supabase.co/functions/v1/billing-production/events';
  const fake={event:'transaction.updated',environment:'prod',timestamp:1791670000,
    data:{transaction:{id:'g12_invalid_probe',reference:'JCO_INVALID_PROBE_2026',
      amount_in_cents:10000,currency:'COP',status:'APPROVED'}},
    signature:{properties:['transaction.id'],checksum:'0'.repeat(64)}};
  const res=await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(fake),
    redirect:'error',signal:AbortSignal.timeout(12000)
  });
  const text=await res.text();
  assert.ok(text.length<700);
  // Do NOT echo the response body or secrets in CI.
  if(res.status===503) throw new Error('Wompi LIVE secrets are missing or malformed in Supabase; gateway correctly fails closed (503)');
  assert.equal(res.status,401,'Expected reject invalid webhook signature (401)');
  const reply=JSON.parse(text);
  assert.equal(reply.error,'invalid_signature');
  console.log('G12 LIVE merchant secret prefixes: runtime-present; fake webhook rejected 401. No charge created.');
});
