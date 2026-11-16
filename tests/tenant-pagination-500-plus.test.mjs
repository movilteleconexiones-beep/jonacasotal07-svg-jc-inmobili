import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {readCompletePages} from '../src/lib/tenant-pagination.ts';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function fixture(size,mutate){
  const data=Array.from({length:size},(_,i)=>({id:'p'+String(i).padStart(6,'0'),organization_id:'qa-org'}));
  let calls=0;
  return {
    data,
    calls:()=>calls,
    read:(from,to)=>{
      calls++;
      let page={data:data.slice(from,to+1),count:data.length,error:null};
      return Promise.resolve(mutate?mutate(page,{from,to,calls}):page);
    },
  };
}
test('G19: 501, 1001, 2000 and 2001 records all loaded fully in bounded pages',async()=>{
  for(const size of [0,1,250,251,500,501,999,1000,1001,2000,2001]){
    const input=fixture(size);
    const out=await readCompletePages(input.read,{pageSize:250,key:row=>row.id,maxRows:5000});
    assert.equal(out.length,size);
    assert.equal(new Set(out.map(x=>x.id)).size,size);
    assert.equal(input.calls(),Math.max(1,Math.ceil(size/250)));
  }
});
test('G19: reject server max_rows truncation, count drift, hidden extra and duplicate IDs',async()=>{
  const rows=fixture(501);
  await assert.rejects(()=>readCompletePages((from,to)=>rows.read(from,to).then(v=>({
    ...v,data:v.data.slice(0,100),
  }))),/totalidad de registros/);
  const changed=fixture(501);
  await assert.rejects(()=>readCompletePages((from,to)=>changed.read(from,to).then(v=>({
    ...v,count:from===0?501:502,
  }))),/totalidad de registros/);
  const duplicate=fixture(501);
  await assert.rejects(()=>readCompletePages((from,to)=>duplicate.read(from,to).then(v=>({
    ...v,data:from===250?[{id:'p000001',organization_id:'qa-org'},...v.data.slice(1)]:v.data,
  })),{key:row=>row.id}),/totalidad de registros/);
  await assert.rejects(()=>readCompletePages(fixture(2001).read,{maxRows:2000}),/límite operativo/);
  const forbidden=fixture(5);
  await assert.rejects(()=>readCompletePages(forbidden.read,{pageSize:1000}),/totalidad de registros/);
});
test('G19: all operational paginated selectors retain tenant predicates, ordering and complete count',()=>{
  for(const path of [
    'src/modules/finance/TenantRentEntry.tsx',
    'src/modules/finance/OwnerSettlementEntry.tsx',
    'src/modules/properties/PropertiesModule.tsx',
    'src/modules/rentals/RentalIntakeWizard.tsx',
    'src/modules/reports/MonthlyAccountingReport.tsx',
    'src/modules/reports/ReportsModule.tsx',
  ]){
    const src=read(path);
    assert.match(src,/readCompletePages\(/,path);
    assert.match(src,/count:'exact'/,path);
    assert.match(src,/\.range\(from,to\)/,path);
    assert.match(src,/\.eq\('organization_id',(?:organizationId|targetOrganization)\)/,path);
  }
  const props=read('src/modules/properties/PropertiesModule.tsx');
  assert.match(props,/loadSequence\.current\+\+/);
  assert.match(props,/scope\.current!==targetOrganization/);
  assert.doesNotMatch(props,/\.limit\(501\)/,'The inventory no longer blocks at 500 occupied properties');
  const finance=read('src/modules/finance/OwnerSettlementEntry.tsx');
  assert.match(finance,/\.eq\('period_month',period\+'-01'\)/);
  assert.match(finance,/\[organizationId,revision,period\]/);
  assert.match(finance,/if\(!permitted\|\|loading\|\|busy/);
  const rent=read('src/modules/finance/TenantRentEntry.tsx');
  assert.match(rent,/\.neq\('status','PAID'\)\.neq\('status','CANCELLED'\)/);
  const wiz=read('src/modules/rentals/RentalIntakeWizard.tsx');
  assert.match(wiz,/offset\+=75/);
  assert.match(wiz,/properties\.length!==ids\.length/);
});
