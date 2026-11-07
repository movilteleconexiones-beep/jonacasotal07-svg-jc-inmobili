import assert from 'node:assert/strict';
import {test} from 'node:test';

const host='http://127.0.0.1:3100';
const routes=[
  ['activities','id,contacts(id),deals(id),leads(id),properties(id)'],
  ['appointments','id,contacts(id),leads(id),properties(id)'],
  ['property_consignments','id,contacts(id),leads(id),properties(id)'],
  ['property_private_photos','id,properties(id)'],
  ['commissions','id,deals(id)'],
  ['portal_access_links','id,contacts(id),property_owners(id)'],
  ['leads','id,contacts(id),properties(id)'],
  ['contacts','id,leads(id)'],
  ['properties','id,property_private_photos(id)'],
  ['activities','id,contact:contacts!activities_contact_id_fkey(id),deal:deals!activities_deal_id_fkey(id)'],
  ['appointments','id,contact:contacts!appointments_contact_id_fkey(id)'],
  ['property_consignments','id,property:properties!property_consignments_property_id_fkey(id)'],
];

for (const [table,embed] of routes) {
  test(`G08 PostgREST relationship compatibility: ${table} ${embed}`,async()=>{
    const address=`${host}/${table}?select=${encodeURIComponent(embed)}&limit=3`;
    const res=await fetch(address,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000)});
    const body=await res.text();
    assert.equal(res.status,200,`PostgREST relationship query failed: ${table} ${embed}: ${body.slice(0,550)}`);
    const result=JSON.parse(body);
    assert.ok(Array.isArray(result),'Expected PostgREST JSON array');
    assert.ok(result.length>0,'Fixture should include representative rows');
  });
}
